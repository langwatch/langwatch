import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // Several suites mock @langwatch/observability; a shared graph caches the real one first.
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
