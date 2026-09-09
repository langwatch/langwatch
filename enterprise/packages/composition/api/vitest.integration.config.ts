import { defineConfig } from "vitest/config";

/**
 * Integration lane: the suites that need real datastores — Postgres at
 * `DATABASE_URL` and ClickHouse at `TEST_CLICKHOUSE_URL`. Each one skips
 * itself when its endpoint is absent.
 */
export default defineConfig({
  test: {
    include: ["{src,tests}/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
