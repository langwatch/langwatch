import { fileURLToPath } from "node:url";

import { defineModuleVitestConfig } from "@langwatch/vitest-config";
import { mergeConfig } from "vitest/config";

export default mergeConfig(
  defineModuleVitestConfig({
    kind: "jsdom",
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // The screen's suite drives real user events through Chakra overlays; under
      // a fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite rather than the
      // default. The same budget gateway-web, automation-web and agent-web took.
      testTimeout: 30_000,
    },
  }),
  {
    resolve: {
      alias: {
        "@langwatch/data-retention-contract": fileURLToPath(
          new URL("../contract/src/index.ts", import.meta.url),
        ),
      },
    },
  },
);
