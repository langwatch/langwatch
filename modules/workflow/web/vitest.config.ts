import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Two screens with Chakra overlays driven through real user events, on top
    // of the graph suites this package already had. The same budget every other
    // feature-web package took, for the same reason: a Chakra overlay under a
    // loaded worker pool is slow, not broken.
    testTimeout: 30_000,
  },
});
