import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    watch: false,
    testTimeout: 10000,
    // This package's own suite asserts on createLogger's real behaviour
    // (levels, transports), so it opts out of the vitest-wide test silencing
    // that createLogger otherwise applies to every other package.
    env: { LANGWATCH_TEST_LOGS: "1" },
  },
});
