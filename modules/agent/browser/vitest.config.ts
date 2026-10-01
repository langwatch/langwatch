import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Anchored, so the package root keeps its alias while the contract's
    // subpath exports (`/code-config`, `/http-test`) resolve through its own
    // exports map rather than being rewritten into `index.ts/<subpath>`.
    alias: [
      {
        find: /^@langwatch\/agent-contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    // Ten suites replace modules with vi.mock, so each file needs its own registry.
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // The screen's suite drives real user events through Chakra overlays; under
      // a fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite rather than the
      // default. The same budget gateway-web and automation-web took.
      testTimeout: 30_000,
    },
  }),
});
