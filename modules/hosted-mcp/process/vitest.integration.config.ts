import { defineConfig } from "vitest/config";

/**
 * Integration lane: the cross-replica suite, which needs Redis at
 * `LANGWATCH_TEST_REDIS_URL`/`REDIS_URL`: a session recovered on another
 * replica is a real read between two handlers.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    include: ["src/**/hosted-mcp.streamable-reconnect.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
