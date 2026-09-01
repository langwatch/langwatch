import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // The authoring drawer's suites drive real user events through Chakra
    // overlays and a Monaco stub; under a fully loaded worker pool the slowest
    // of them clears 5s while passing comfortably alone, so the budget reflects
    // the suite rather than the default. The same budget gateway-web took.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@langwatch/authz-contract": fileURLToPath(
        new URL("../../authz/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/automation-contract": fileURLToPath(
        new URL("../contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/dataset-contract": fileURLToPath(
        new URL("../../dataset/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/monitor-contract": fileURLToPath(
        new URL("../../monitor/contract/src/index.ts", import.meta.url),
      ),
      "@langwatch/trace-contract": fileURLToPath(
        new URL("../../trace/contract/src/index.ts", import.meta.url),
      ),
    },
  },
});
