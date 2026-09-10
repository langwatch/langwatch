import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
