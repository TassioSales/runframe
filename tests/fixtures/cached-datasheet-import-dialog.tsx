import { expect, mock, test } from "bun:test"
import type { PlatformConfig } from "@tscircuit/props"
import { JSDOM } from "jsdom"
import { act } from "react"
import type { AnyCircuitElement } from "circuit-json"
import type { JlcpcbComponentSummary } from "../../lib/components/ImportComponentDialog2/types"

const savedFiles = mock(async (_path: string, _tsx: string) => {})
const registryImport = mock(async () => {})
const supplierImport = mock(async () => {})
const kicadImport = mock(async () => {})
const onlineSearch = mock(async () => [
  {
    package_id: "remote-package",
    org_owner_tscircuit_handle: "example",
    unscoped_name: "RemoteComponent",
    name: "example/RemoteComponent",
    description: "Online result",
  },
])
const supplierSearch = mock(async (): Promise<JlcpcbComponentSummary[]> => {
  throw new Error("Unexpected JLC search")
})
const supplierLoad = mock(async (): Promise<string> => {
  throw new Error("Unexpected EasyEDA import")
})
const supplierPreview = mock(async (): Promise<AnyCircuitElement[]> => {
  throw new Error("Unexpected EasyEDA preview")
})
const kicadSearch = mock(async () => {
  throw new Error("Unexpected KiCad search")
})
const kicadLoad = mock(async () => {
  throw new Error("Unexpected KiCad preview")
})
const previewJson: unknown[] = []

mock.module("lib/components/RunFrameWithApi/store", () => ({
  useRunFrameStore: (selector: (store: unknown) => unknown) =>
    selector({
      upsertFile: savedFiles,
      pushEvent: registryImport,
    }),
}))
mock.module("lib/utils/toast", () => ({
  toast: { promise: async (promise: Promise<unknown>) => await promise },
}))
mock.module("lib/components/ImportComponentDialog2/api/tscircuit", () => ({
  searchTscircuitPackages: onlineSearch,
}))
mock.module("lib/components/ImportComponentDialog2/api/jlcpcb", () => ({
  searchJlcpcbComponents: supplierSearch,
  mapJlcpcbComponentToSummary: (value: unknown) => value,
  loadJlcpcbComponentTsx: supplierLoad,
  loadJlcpcbComponentCircuitJson: supplierPreview,
}))
mock.module("lib/components/ImportComponentDialog2/api/kicad", () => ({
  searchKicadFootprints: kicadSearch,
  mapKicadFootprintToSummary: (value: unknown) => value,
  loadKicadFootprintCircuitJson: kicadLoad,
}))
mock.module(
  "lib/components/ImportComponentDialog2/components/TscircuitPackageDetailsDialog",
  () => ({
    TscircuitPackageDetailsDialog: () => null,
  }),
)
mock.module("@tscircuit/pcb-viewer", () => ({
  PCBViewer: ({ circuitJson }: { circuitJson: unknown }) => {
    previewJson.push(circuitJson)
    return <pre data-testid="local-preview">{JSON.stringify(circuitJson)}</pre>
  },
}))

const datasheetId = "b274f623-8acd-4b58-9448-96465d49f0e4"
const entry = {
  datasheet_id: datasheetId,
  chip_name: "CachedChip",
  description: "Cached SOIC component",
}
const datasheet = {
  datasheet_id: datasheetId,
  chip_name: entry.chip_name,
  ai_description: entry.description,
  footprinter_string: "soic8",
  pin_information: Array.from({ length: 8 }, (_, index) => ({
    pin_number: String(index + 1),
    name: [`SIGNAL${index + 1}`],
  })),
}

test("cached search, generated preview, and CLI save use only platformFetch", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost",
    pretendToBeVisual: true,
  })
  const names = [
    "window",
    "document",
    "location",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLButtonElement",
    "Node",
    "NodeFilter",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "CustomEvent",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "DocumentFragment",
    "navigator",
  ]
  const previous = Object.fromEntries(
    names.map((name) => [name, (globalThis as any)[name]]),
  )
  const previousFetch = globalThis.fetch
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[name],
    })
  }
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  const network = mock(async () => {
    throw new Error("Unexpected global fetch")
  })
  globalThis.fetch = network as unknown as typeof fetch
  const localRequests: string[] = []
  let cacheMiss = false
  const platformFetch: typeof fetch = async (input) => {
    const url = new URL(input.toString(), "http://localhost")
    localRequests.push(url.pathname)
    if (cacheMiss) {
      throw new Error(
        "Cached datasheet is missing; populate the cache before importing",
      )
    }
    if (url.pathname.endsWith("/list")) {
      return Response.json({ datasheets: [entry] })
    }
    if (url.pathname.endsWith("/get")) {
      return Response.json({ datasheet })
    }
    throw new Error(`Unexpected platform request: ${url}`)
  }
  const { createRoot } = await import("react-dom/client")
  const { ImportComponentDialogForCli } = await import(
    "../../lib/components/ImportComponentDialog2/ImportComponentDialogForCli"
  )
  const { ImportComponentDialog2 } = await import(
    "../../lib/components/ImportComponentDialog2/ImportComponentDialog2"
  )
  const platformConfig: PlatformConfig = { platformFetch }
  const root = createRoot(document.getElementById("root")!)
  const closed = mock(() => {})

  const search = async (query: string) => {
    const input = document.querySelector("input")!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!
      setter.call(input, query)
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
    const button = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Search",
    )!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
  }
  const importButton = () =>
    Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Import",
    )!
  const select = async (name: string) => {
    const row = Array.from(
      document.querySelectorAll(".rf-cursor-pointer"),
    ).find((row) => row.textContent?.includes(name))!
    expect(row).toBeDefined()
    await act(async () => (row as HTMLElement).click())
  }

  try {
    await act(async () =>
      root.render(
        <ImportComponentDialogForCli
          isOpen
          onClose={closed}
          cachedDatasheetImports
          platformConfig={platformConfig}
        />,
      ),
    )
    expect(document.body.textContent).toContain("Cached Datasheets")
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0)
    await search("CachedChip")
    await select("CachedChip")
    expect(
      document.querySelector('[data-testid="local-preview"]'),
    ).not.toBeNull()
    expect(
      (previewJson.at(-1) as any[]).some(
        (element) => element.type === "pcb_smtpad",
      ),
    ).toBe(true)
    await act(async () => importButton().click())
    expect(savedFiles).toHaveBeenCalledTimes(1)
    expect(savedFiles.mock.calls[0]![0]).toBe("imports/CachedChip.tsx")
    expect(savedFiles.mock.calls[0]![1]).toContain("export const CachedChip")
    expect(closed).toHaveBeenCalledTimes(1)
    expect(localRequests).toContain("/datasheets/list")
    expect(localRequests).toContain("/datasheets/get")

    await search("CachedChip")
    cacheMiss = true
    await select("CachedChip")
    expect(document.body.textContent).toContain("Cached datasheet is missing")
    await act(async () => importButton().click())
    expect(savedFiles).toHaveBeenCalledTimes(1)
    expect(closed).toHaveBeenCalledTimes(1)

    await search("Unknown")
    expect(document.body.textContent).toContain("Cached datasheet is missing")
    expect(importButton().disabled).toBe(true)
    expect(savedFiles).toHaveBeenCalledTimes(1)

    await act(async () =>
      root.render(
        <ImportComponentDialogForCli
          isOpen
          onClose={closed}
          cachedDatasheetImports
        />,
      ),
    )
    await search("CachedChip")
    expect(document.body.textContent).toContain(
      "require platformConfig.platformFetch",
    )
    expect(importButton().disabled).toBe(true)

    // Begin with an online registry result, then switch the same mounted dialog.
    const onlineProps = {
      isOpen: true,
      onClose: closed,
      onTscircuitPackageSelected: registryImport,
      onJlcpcbComponentTsxLoaded: supplierImport,
      onKicadStringSelected: kicadImport,
      onDatasheetComponentTsxLoaded: mock(async () => {}),
      platformConfig,
    }
    await act(async () =>
      root.render(<ImportComponentDialog2 {...onlineProps} />),
    )
    await search("RemoteComponent")
    await select("RemoteComponent")
    expect(importButton().disabled).toBe(false)
    cacheMiss = false
    await act(async () =>
      root.render(
        <ImportComponentDialog2 {...onlineProps} cachedDatasheetImports />,
      ),
    )
    expect(document.body.textContent).not.toContain("RemoteComponent")
    expect(document.body.textContent).not.toContain("JLCPCB Parts")
    expect(document.body.textContent).not.toContain("KiCad Footprints")
    expect(importButton().disabled).toBe(true)
    await act(async () => importButton().click())
    expect(registryImport).not.toHaveBeenCalled()
    expect(supplierImport).not.toHaveBeenCalled()
    expect(kicadImport).not.toHaveBeenCalled()
    expect(supplierSearch).not.toHaveBeenCalled()
    expect(supplierLoad).not.toHaveBeenCalled()
    expect(supplierPreview).not.toHaveBeenCalled()
    expect(kicadSearch).not.toHaveBeenCalled()
    expect(kicadLoad).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()

    // A load started in online mode must not complete an online import after
    // the host enables the cached catalog.
    supplierSearch.mockImplementation(async () => [
      {
        lcscId: 123,
        manufacturer: "InFlightChip",
        partNumber: "C123",
        description: "Online supplier part",
        package: "SOIC-8",
      },
    ])
    supplierPreview.mockImplementation(async () => [])
    let finishOnlineLoad!: (tsx: string) => void
    supplierLoad.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishOnlineLoad = resolve
        }),
    )
    const supplierProps = {
      isOpen: true,
      onClose: closed,
      onJlcpcbComponentTsxLoaded: supplierImport,
      onDatasheetComponentTsxLoaded: onlineProps.onDatasheetComponentTsxLoaded,
      platformConfig,
    }
    await act(async () =>
      root.render(<ImportComponentDialog2 {...supplierProps} />),
    )
    await search("InFlightChip")
    await select("InFlightChip")
    await act(async () => importButton().click())
    expect(supplierLoad).toHaveBeenCalledTimes(1)
    await act(async () =>
      root.render(
        <ImportComponentDialog2 {...supplierProps} cachedDatasheetImports />,
      ),
    )
    await act(async () =>
      finishOnlineLoad("export const InFlightChip = () => null"),
    )
    expect(supplierImport).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Import source changed")
    expect(network).not.toHaveBeenCalled()

    for (const removeTransport of [false, true]) {
      let partReads = 0
      let finishPartRead!: (response: Response) => void
      const delayedTransport: typeof fetch = async (input) => {
        const url = new URL(input.toString())
        if (url.pathname.endsWith("/list")) {
          return Response.json({ datasheets: [entry] })
        }
        partReads++
        // The preview completes, while the subsequent import remains pending.
        if (partReads === 1) return Response.json({ datasheet })
        return new Promise<Response>((resolve) => {
          finishPartRead = resolve
        })
      }
      const renderCached = (nextPlatformConfig?: PlatformConfig) => (
        <ImportComponentDialogForCli
          isOpen
          onClose={closed}
          cachedDatasheetImports
          platformConfig={nextPlatformConfig}
        />
      )
      await act(async () =>
        root.render(renderCached({ platformFetch: delayedTransport })),
      )
      await search("CachedChip")
      await select("CachedChip")
      await act(async () => importButton().click())
      expect(partReads).toBe(2)
      const replacementTransport: typeof fetch = async () =>
        Response.json({ datasheet })
      await act(async () =>
        root.render(
          renderCached(
            removeTransport
              ? undefined
              : { platformFetch: replacementTransport },
          ),
        ),
      )
      await act(async () => finishPartRead(Response.json({ datasheet })))
      expect(savedFiles).toHaveBeenCalledTimes(1)
      expect(closed).toHaveBeenCalledTimes(1)
      expect(importButton().disabled).toBe(true)
      expect(document.body.textContent).toContain("Import source changed")
      expect(network).not.toHaveBeenCalled()
    }
  } finally {
    await act(async () => root.unmount())
    globalThis.fetch = previousFetch
    Object.assign(globalThis, previous, { IS_REACT_ACT_ENVIRONMENT: false })
    dom.window.close()
  }
})
