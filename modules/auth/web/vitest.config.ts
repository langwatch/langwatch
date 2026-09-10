import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  isolate: true,
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The front door's screens drive multi-step forms through real user events
    // and animate between them. The same budget every other feature-web package
    // took, for the same reason: a Chakra overlay under a loaded worker pool is
    // slow, not broken.
    testTimeout: 30_000,
  },
});
