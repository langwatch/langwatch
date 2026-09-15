import { defineModuleVitestConfig } from "../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    fsModuleCache: true,
    watch: false,
    testTimeout: 10000,
  },
});
