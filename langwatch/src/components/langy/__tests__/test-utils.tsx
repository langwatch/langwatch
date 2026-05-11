/**
 * Shared helpers for Langy component tests. Per implementation-plan.md PR-1.1.
 *
 * Two responsibilities:
 *   1. Polyfill the web stream globals (`TransformStream` etc.) that
 *      jsdom does not provide. The `ai` package (transitively imported
 *      by LangySidebar via `useChat`) needs them at module-load time.
 *      Call `installLangyJsdomPolyfills()` in a `vi.hoisted(...)` block
 *      at the top of the test file so it runs before the imports.
 *   2. Wrap rendered components in `ChakraProvider` consistently.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export function installLangyJsdomPolyfills(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const streamWeb = require("node:stream/web") as {
    TransformStream: unknown;
    ReadableStream: unknown;
    WritableStream: unknown;
  };
  if (
    typeof (globalThis as { TransformStream?: unknown }).TransformStream ===
    "undefined"
  ) {
    Object.assign(globalThis, {
      TransformStream: streamWeb.TransformStream,
      ReadableStream:
        (globalThis as { ReadableStream?: unknown }).ReadableStream ??
        streamWeb.ReadableStream,
      WritableStream:
        (globalThis as { WritableStream?: unknown }).WritableStream ??
        streamWeb.WritableStream,
    });
  }
}

export function renderWithChakra(ui: ReactElement): RenderResult {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}
