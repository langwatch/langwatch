import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
