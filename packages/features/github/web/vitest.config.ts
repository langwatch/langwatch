import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // One settings screen with a card, a row of installs and a disconnect
    // driven through real user events. The same budget every other feature-web
    // package took, for the same reason: a Chakra overlay under a loaded worker
    // pool is slow, not broken.
    testTimeout: 30_000,
  },
});
