import { fileURLToPath } from "node:url";

import { moduleVitestTestOptions } from "@langwatch/vitest-config";
import { defineConfig } from "vitest/config";

export default defineConfig({
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
  test: moduleVitestTestOptions({
    kind: "jsdom",
    // Twelve suites mock the ops api binding with different shapes, so each
    // file needs its own module registry or one file's mock leaks into the next.
    isolate: true,
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./vitest.setup.ts"],
      // The drawer suites drive real user events through Chakra overlays; under a
      // fully loaded worker pool the slowest of them clears 5s while passing
      // comfortably alone, so the budget reflects the suite, not the default.
      testTimeout: 30_000,
    },
  }),
});
