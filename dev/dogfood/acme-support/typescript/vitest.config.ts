import { defineModuleVitestConfig } from "../../../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
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
