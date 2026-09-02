import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The evaluators screen drives a delete confirmation, a replicate dialog
    // and a push-to-replicas dialog through real user events. The same budget
    // every other feature-web package took, for the same reason: a Chakra
    // overlay under a loaded worker pool is slow, not broken.
    testTimeout: 30_000,
  },
});
