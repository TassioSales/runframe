import { test } from "bun:test"
import { runIsolatedUiTest } from "./fixtures/run-isolated-ui-test"

test("cached datasheet imports search, preview, save, and fail without online fallback", async () => {
  await runIsolatedUiTest(
    new URL("./fixtures/cached-datasheet-import-dialog.tsx", import.meta.url),
  )
}, 20000)
