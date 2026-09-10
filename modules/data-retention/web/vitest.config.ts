import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { moduleVitestTestOptions } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineConfig({
  resolve: {
    alias: {
      "@langwatch/data-retention-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
  test: moduleVitestTestOptions({
    kind: "jsdom",
    isolate: true,
    test: {
      setupFiles: ["./vitest.setup.ts"],
      // The screen's suite drives real user events through Chakra overlays; under
      // a fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite rather than the
      // default. The same budget gateway-web, automation-web and agent-web took.
      testTimeout: 30_000,
    },
  }),
});
