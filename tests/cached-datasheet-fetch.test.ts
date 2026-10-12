import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createCachedDatasheetFetch,
  DatasheetCacheMissError,
} from "../lib/optional-features/importing/datasheet-catalog/create-cached-datasheet-fetch"

const originalFetch = globalThis.fetch
let externalFetch: ReturnType<typeof mock>
beforeEach(() => {
  externalFetch = mock(() => {
    throw new Error("External networking is disabled")
  })
  globalThis.fetch = externalFetch as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = originalFetch
  expect(externalFetch).not.toHaveBeenCalled()
})

test("datasheet requests read files from the local cache with fresh Response bodies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runframe-datasheets-"))
  const payload = {
    datasheet: { datasheet_id: "ds-rp2040", chip_name: "RP2040" },
  }
  try {
    await writeFile(
      join(directory, "index.json"),
      JSON.stringify({
        datasheets: [{ datasheet_id: "ds-rp2040", chip_name: "RP2040" }],
      }),
    )
    await mkdir(join(directory, "parts"))
    await writeFile(
      join(directory, "parts", "rp2040.json"),
      JSON.stringify(payload),
    )
    const platformFetch = createCachedDatasheetFetch({
      cacheDirectory: directory,
      readCacheFile: (path) => readFile(path, "utf-8"),
    })
    const byName = "https://api.tscircuit.com/datasheets/get?chip_name=RP2040"
    expect(await (await platformFetch(byName)).json()).toEqual(payload)
    expect(await (await platformFetch(new Request(byName))).json()).toEqual(
      payload,
    )
    expect(
      await (
        await platformFetch(
          new URL(
            "https://api.tscircuit.com/datasheets/get?datasheet_id=ds-rp2040",
          ),
        )
      ).json(),
    ).toEqual(payload)
    expect(
      await (
        await platformFetch("https://api.tscircuit.com/datasheets/list")
      ).json(),
    ).toMatchObject({
      datasheets: [{ chip_name: "RP2040" }],
    })
    await expect(
      platformFetch(
        "https://api.tscircuit.com/datasheets/get?chip_name=missing",
      ),
    ).rejects.toBeInstanceOf(DatasheetCacheMissError)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("normalization confines filenames to the cache and supports a configured API base", async () => {
  const reader = mock(() => "{}")
  const platformFetch = createCachedDatasheetFetch({
    readCacheFile: reader,
    apiBaseUrl: "https://example.test/api",
  })
  await platformFetch(
    "https://example.test/api/datasheets/get?chip_name=..%2FAP2112K-3.3",
  )
  expect(reader).toHaveBeenCalledWith(".cache/datasheets/parts/ap2112k-33.json")
})

test("missing cache files and IDs fail locally", async () => {
  const platformFetch = createCachedDatasheetFetch({
    readCacheFile: () => null,
  })
  await expect(
    platformFetch("https://api.tscircuit.com/datasheets/list"),
  ).rejects.toThrow(".cache/datasheets/index.json")
  const noId = createCachedDatasheetFetch({
    readCacheFile: () => '{"datasheets":[]}',
  })
  await expect(
    noId("https://api.tscircuit.com/datasheets/get?datasheet_id=unknown"),
  ).rejects.toBeInstanceOf(DatasheetCacheMissError)
})

test("part names cannot collide with the catalog index", async () => {
  const reader = mock(() => "{}")
  const platformFetch = createCachedDatasheetFetch({ readCacheFile: reader })
  await platformFetch(
    "https://api.tscircuit.com/datasheets/get?chip_name=index",
  )
  expect(reader).toHaveBeenCalledWith(".cache/datasheets/parts/index.json")
})

test("unrecognized destinations, methods and ambiguous requests never read or fetch", async () => {
  const reader = mock(() => "{}")
  const platformFetch = createCachedDatasheetFetch({ readCacheFile: reader })
  for (const url of [
    "https://jlcsearch.tscircuit.com/api/search?q=RP2040",
    "https://api.tscircuit.com/datasheets/create",
    "https://api.tscircuit.com/datasheets/list?limit=10",
    "https://api.tscircuit.com/datasheets/get?chip_name=RP2040&chip_name=other",
    "https://api.tscircuit.com/datasheets/get?chip_name=RP2040&datasheet_id=id",
    "https://api.tscircuit.com/datasheets/get?chip_name=...",
    "https://user:password@api.tscircuit.com/datasheets/list",
    "https://api.tscircuit.com/datasheets/list#fragment",
    "/datasheets/list",
  ]) {
    await expect(platformFetch(url)).rejects.toThrow(
      "Unsupported cached datasheet request",
    )
  }
  await expect(
    platformFetch("https://api.tscircuit.com/datasheets/list", {
      method: "POST",
    }),
  ).rejects.toThrow("Unsupported cached datasheet request")
  expect(reader).not.toHaveBeenCalled()
})

test("aborted requests do not read the cache or return a completed read", async () => {
  const controller = new AbortController()
  const reader = mock(() => "{}")
  const platformFetch = createCachedDatasheetFetch({ readCacheFile: reader })
  controller.abort(new Error("cancelled"))
  await expect(
    platformFetch("https://api.tscircuit.com/datasheets/list", {
      signal: controller.signal,
    }),
  ).rejects.toThrow("cancelled")
  expect(reader).not.toHaveBeenCalled()
  const inherited = new Request("https://api.tscircuit.com/datasheets/list", {
    signal: controller.signal,
  })
  await platformFetch(inherited, { signal: null })
  expect(reader).toHaveBeenCalledTimes(1)
  const later = new AbortController()
  const delayed = createCachedDatasheetFetch({
    readCacheFile: async () => {
      later.abort(new Error("cancelled while reading"))
      return "{}"
    },
  })
  await expect(
    delayed("https://api.tscircuit.com/datasheets/list", {
      signal: later.signal,
    }),
  ).rejects.toThrow("cancelled while reading")
})
