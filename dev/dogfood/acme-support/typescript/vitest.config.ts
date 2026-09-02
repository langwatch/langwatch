import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // The scenario tests run the agent in this process, so the run needs no
    // connection to the platform.
    env: { LANGWATCH_AGENT_CONNECT: "0" },
  },
});
