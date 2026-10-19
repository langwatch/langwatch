import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // Two suites replace modules with vi.mock, so each file needs its own registry.
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
