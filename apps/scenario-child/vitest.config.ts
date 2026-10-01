import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // The adapter suites mock undici, ai and the tracing seam per file, as they did in the scenario
  // module's default-isolated lane; a shared module graph would leak one file's mock into the next.
  isolate: true,
  test: {
    watch: false,
    // The suite runs the real esbuild bundle, which is slower than a unit test.
    testTimeout: 120_000,
  },
});
