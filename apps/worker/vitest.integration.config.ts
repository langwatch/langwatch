import { defineConfig } from "vitest/config";

/**
 * This application's integration lane: every `*.integration.test.ts` under
 * `src/`, the complement of what `vitest.config.ts` excludes.
 */

/*
 * WHAT IT NEEDS: a build toolchain, and for the live suites Postgres, Redis and
 * ClickHouse at `LANGWATCH_TEST_DATABASE_URL`, `LANGWATCH_TEST_REDIS_URL` and
 * `LANGWATCH_TEST_CLICKHOUSE_URL` (memory-store suites need none). A file added
 * here that reaches a datastore says so rather than relying on a repository-wide
 * rule to notice.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
