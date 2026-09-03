import { defineConfig } from "vitest/config";

/**
 * This package's integration lane.
 *
 * WHAT IT NEEDS
 *
 *   ClickHouse, migrated — the `trace_summaries` and `trace_analytics`
 *   repository suites assert the DDL↔repository column contract against the
 *   PRODUCTION schema, so they read the connection string the job supplies
 *   (`TEST_CLICKHOUSE_URL`, else `CI_CLICKHOUSE_URL`) and skip themselves when
 *   there is none. Nothing here provisions a datastore of its own.
 *
 * The other two files in the lane are datastore-free — they drive the real
 * privacy resolution and the export generator over doubles — and pass with no
 * services at all. They are here because the lane is the suffix, not the
 * dependency: keeping the split at `*.integration.test.ts` is what makes
 * "which files does CI run" answerable from the file name.
 *
 * `include` is a GLOB on purpose. The sibling package's integration config
 * enumerated one literal path and the file moved; run it as it stood and vitest
 * exits 1 with "No test files found". A glob over the suffix the unit config
 * excludes by cannot fall out of step with it.
 *
 * Serial forks, because the ClickHouse suites share one server and one set of
 * tables, and clean up by tenant in `afterAll`.
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
