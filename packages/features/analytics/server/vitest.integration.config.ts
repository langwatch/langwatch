import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs ClickHouse, at `CI_CLICKHOUSE_URL`/`TEST_CLICKHOUSE_URL`
 * — the analytics repository and LangWatch-QL suites assert against a real
 * server.
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
