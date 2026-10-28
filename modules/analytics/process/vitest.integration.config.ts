import { raiseWorkerCountInCI } from "@langwatch/test-harness/integration-file-concurrency";
import { defineConfig } from "vitest/config";

// The slowest package suite, and its files share no state, so in CI, where it has
// its shard to itself, they run three at a time.
// Spec: specs/ci/package-suite-integration-lane.feature
raiseWorkerCountInCI({ workers: 3 });

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
