import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // The drawer suites drive real user events through Chakra overlays; under a
    // fully loaded worker pool the slowest of them clears 5s while passing
    // comfortably alone, so the budget reflects the suite, not the default.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@langwatch/ops-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/feature-flag-contract": fileURLToPath(
        new URL("../../feature-flag/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
