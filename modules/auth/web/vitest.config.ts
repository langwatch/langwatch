import { defineConfig } from "vitest/config";

export default defineConfig({
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
