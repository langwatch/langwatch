import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs Postgres (`DATABASE_URL`) and ClickHouse
 * (`CI_CLICKHOUSE_URL`/`TEST_CLICKHOUSE_URL`) — the simulation repository
 * and persistence-port suites assert against real rows.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
