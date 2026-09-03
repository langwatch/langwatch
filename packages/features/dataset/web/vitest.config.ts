import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The screen suites drive real user events through Chakra overlays; under a
    // fully loaded worker pool the slowest of them clears 5s while passing
    // comfortably alone, so the budget reflects the suites rather than the
    // default. The same budget the families before this one took.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@langwatch/dataset-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
