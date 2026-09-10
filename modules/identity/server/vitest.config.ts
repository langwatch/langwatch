import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
