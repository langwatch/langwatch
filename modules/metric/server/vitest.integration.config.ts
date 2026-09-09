import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs ClickHouse — the canonical metric repository's fold runs
 * its real INSERT/SELECT SQL against the migrated `metric_data_points`,
 * `metric_usage_estimates` and `metric_time_rollups` tables.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 600_000,
    teardownTimeout: 30_000,
  },
});
