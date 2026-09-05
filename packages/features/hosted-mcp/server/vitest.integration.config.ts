import { defineConfig } from "vitest/config";

/**
 * Integration lane: the cross-replica suites, which need Redis at
 * `LANGWATCH_TEST_REDIS_URL`/`REDIS_URL`. A relayed message is a real publish
 * between two handlers, provable with neither one handler nor a stub.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/hosted-mcp.sse-relay.integration.test.ts",
      "src/**/hosted-mcp.streamable-reconnect.integration.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
