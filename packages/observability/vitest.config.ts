import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // Nine files vi.mock the logger and SDK modules; a shared graph lets one
  // file's mock decide another's result. See packages/system-migrations.
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10000,
    // This package's own suite asserts on createLogger's real behaviour
    // (levels, transports), so it opts out of the vitest-wide test silencing
    // that createLogger otherwise applies to every other package.
    env: { LANGWATCH_TEST_LOGS: "1" },
  },
});
