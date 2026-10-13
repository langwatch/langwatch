import { defineConfig } from "vitest/config";

// Standalone on purpose: this sample installs from npm the way a customer's
// project does, so it declares no workspace package. It reached into
// packages/test-harness/src by relative path before, which resolved only
// because the checkout happened to sit above it.
export default defineConfig({
  test: {
    environment: "node",
    isolate: false,
    pool: "forks",
    watch: false,
    include: ["tests/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // The scenario tests run the agent in this process, so the run needs no
    // connection to the platform.
    env: { LANGWATCH_AGENT_CONNECT: "0" },
  },
});
