import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  // Fast mode's css:false breaks identity-storage-adapter-refusal-logging.unit.test.ts
  // (see vitest perf lane report); this package opts out of that one option.
  css: true,
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
