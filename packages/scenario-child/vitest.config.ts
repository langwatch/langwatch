import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    watch: false,
    // The suite runs the real esbuild bundle, which is slower than a unit test.
    testTimeout: 120_000,
  },
});
