import { raiseWorkerCountInCI } from "@langwatch/test-harness/integration-file-concurrency";
import { defineConfig } from "vitest/config";

// The slowest suite in the package-suites job (270 to 400s), and almost all of it
// standing up datastores: each LangWatchQL file starts its own PostgreSQL container
// and its own database, reader and settings profile on a shared ClickHouse
// (lwqlNamesForSuite), and the migrated-schema files key every row by a tenant id
// unique to the run. No file can see another's state, so in CI, where the suite has
// its shard to itself, its files run three at a time. They already ran two at a
// time: the vitest launcher exports VITEST_MAX_WORKERS=2, which outranks
// `fileParallelism: false` (specs/setup/integration-file-serialism.feature).
// Spec: specs/ci/package-suite-integration-lane.feature
raiseWorkerCountInCI({ env: process.env, workers: 3 });

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs ClickHouse at `CI_CLICKHOUSE_URL`/`TEST_CLICKHOUSE_URL` —
 * the analytics repository and LangWatch-QL suites assert against a real server.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    // Two at a time off CI, as the launcher already ran them; raiseWorkerCountInCI above
    // outranks this in CI.
    fileParallelism: true,
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
