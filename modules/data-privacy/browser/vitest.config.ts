import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  defineModuleVitestConfig({
    kind: "jsdom",
    // Two screen suites mock the package's own api binding with different snapshots; a
    // shared registry lets one file's mock leak into the next.
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // The screen's suite drives real user events through Chakra overlays; under
      // a fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite rather than the
      // default. The same budget the four families before this one took.
      testTimeout: 30_000,
    },
  }),
  {
    resolve: {
      // Exact, so the `/pii-redaction-spend` subpath resolves through the package's exports.
      alias: [
        {
          find: /^@langwatch\/data-privacy-contract$/,
          replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
        },
      ],
    },
  },
);
