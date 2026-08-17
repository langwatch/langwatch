// IMPORTANT: setupEnv MUST be imported FIRST to set CI env vars before any other code runs
// This handles CI_REDIS_URL -> REDIS_URL mapping and deletes BUILD_TIME
import "./src/server/event-sourcing/__tests__/integration/setupEnv";

import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

import {
  integrationFilesRunInParallel,
  withdrawWorkerCountOverride,
} from "./src/test-utils/integrationFileConcurrency";
import {
  INTEGRATION_SEARCH_DIRS,
  partitionIntegrationFiles,
  toIncludePatterns,
} from "./src/test-utils/integrationLanes";
import WeightBalancedSequencer from "./vitest.sequencer";

config();

const { datastore } = partitionIntegrationFiles({
  root: __dirname,
  searchDirs: [...INTEGRATION_SEARCH_DIRS],
});

// One switch for the CI-vs-laptop trade-offs below.
const isCI = !!process.env.CI;

// `fileParallelism` below is the only place that decides whether files run
// concurrently, so a worker count exported by the runner is withdrawn before
// vitest can apply it over the top of that decision. See
// src/test-utils/integrationFileConcurrency.ts for why the two interact.
withdrawWorkerCountOverride(process.env);

export default defineConfig({
  test: {
    // Global setup runs once before all tests - starts shared containers
    globalSetup: [
      "./src/server/event-sourcing/__tests__/integration/globalSetup.ts",
    ],
    setupFiles: [
      // setupEnv.ts MUST run first - sets env vars before any application code loads
      "./src/server/event-sourcing/__tests__/integration/setupEnv.ts",
      // setup.ts sets REDIS_URL/CLICKHOUSE_URL at module load time
      // before test-setup.ts imports any application code
      "./src/server/event-sourcing/__tests__/integration/setup.ts",
      "./test-setup.ts",
    ],
    // The files that actually need a datastore. The complement — jsdom files
    // naming no database, queue or cache — runs on the component lane with no
    // service containers at all (vitest.component.config.ts). Both lanes call
    // partitionIntegrationFiles, so together they are still every integration
    // file, exactly once. See specs/ci/integration-test-lanes.feature.
    include: toIncludePatterns(datastore),
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 60_000, // 60 seconds for testcontainers startup and processing
    hookTimeout: 60_000, // 60 seconds for beforeAll/afterAll hooks
    teardownTimeout: 30_000, // 30 seconds for cleanup
    // Run test files sequentially to avoid BullMQ/Redis resource contention
    // when multiple pipelines are created and destroyed in parallel.
    //
    // Redis is the loudest contention: BullMQ keys a queue by name alone, so
    // two files building the same pipeline share it. ClickHouse is not exempt
    // either. Tenant ids are per suite -- of the 111 integration files that
    // touch ClickHouse there are five hardcoded ids between them, and one
    // appears in more than one file -- but the schema is shared, and the
    // suites that replay goose migrations rebuild rollup tables in place. A
    // file reading such a table while another replays sees it mid-swap.
    //
    // That mid-swap read does not need this flag to happen: vitest starts the
    // next file's fork before the previous file has finished, so an `afterAll`
    // and the next `beforeAll` run at once even with one worker and files
    // serial. Anything mutating shared schema takes its own cross-process lock
    // rather than trusting file order; see withReplayLock in
    // src/server/clickhouse/__tests__/migrationReplay.ts.
    //
    // So parallelism is opt-in rather than impossible: set both
    // VITEST_INTEGRATION_PARALLEL and VITEST_ISOLATE_WORKER_REDIS (see
    // setupEnv.ts, which then gives each worker its own Redis database) and
    // the files can run concurrently.
    //
    // NOTHING SETS THE FIRST ONE TODAY, including CI. It was set for the
    // integration job and withdrawn: groupQueue.decodeDrop and scripts began
    // failing non-deterministically with state vanishing underneath them
    // rather than with a wrong assertion, which is what a flushdb crossing a
    // worker boundary looks like. The per-worker database is not obviously
    // airtight either — setupEnv runs once at config load in the main
    // process, where VITEST_POOL_ID is absent and the id falls back to 1, and
    // again per worker as a setup file. Nothing asserts that two concurrent
    // workers cannot see each other's keys; write that test before setting
    // this again. CI parallelises across shards instead.
    fileParallelism: integrationFilesRunInParallel(process.env),
    // Use forked child processes. We briefly tried pool: "threads" to
    // sidestep the post-test shard 4 wedge, but threads exposes a panic
    // in @prisma/client/query-engine-node-api when the client gets
    // constructed inside a worker-thread context (engine.rs:166 "Failed
    // to deserialize constructor options"). The wedge in forks is
    // handled by a hard-floor process.exit timer in globalSetup.ts.
    pool: "forks",
    // Unlike the unit config, this one does NOT switch pools in CI. The note
    // above is the reason: threads panic inside @prisma/client's query engine,
    // and that is true wherever it runs.
    //
    // This only takes effect when fileParallelism is on: vitest implements
    // `fileParallelism: false` by clamping maxWorkers to 1, so with the flag
    // off, which is the current state everywhere, the value here is inert, and
    // an earlier `isCI ? "100%" : 1` read as if CI were running four
    // workers when it was running one. Keep it honest: ask for two, and let
    // vitest clamp it to one while files are serial. Two rather than every core
    // because the runner has 4 vCPUs and is also hosting ClickHouse, Postgres
    // and Redis; handing vitest the whole box starved the datastores and
    // suites failed on vi.waitFor timeouts rather than on their assertions.
    maxWorkers: isCI ? 2 : 1,
    // Reuse the module registry across the files in the worker instead of
    // rebuilding it per file.
    //
    // This is NOT the concurrency knob above, and the distinction is the whole
    // argument. `fileParallelism` decides whether two files run AT ONCE, which
    // is the property the ClickHouse schema and the Redis keyspace depend on;
    // that stays off. `isolate` decides only whether the second file re-imports
    // the module graph the first already loaded. Files still run strictly one
    // at a time either way, so the earlier VITEST_INTEGRATION_PARALLEL attempt
    // — reverted because concurrent workers lost each other's Redis state — is
    // not what this re-enables.
    //
    // The cost it removes is the largest single line item in the suite.
    // Measured across the six CI shards: 1,664s of `import` against 1,408s of
    // actual test execution, or ~1.8s per file spent rebuilding the same Prisma
    // client, the same zod schemas and the same server graph 171 times a shard.
    // Import was 43% of integration runner time and the tests themselves 37%.
    //
    // The unit lane has run this way at larger scale for some time (1,688 files,
    // vitest.config.ts), so the failure mode is known and narrow: module-level
    // state that outlives a file — a memoised client, a module-scope queue
    // handle, a cached config read at import. That shows up as an
    // order-dependent failure, not as a wrong assertion. If a shard starts
    // flaking that way, drop this line first and read the ordering before
    // reaching for anything else.
    isolate: false,
    // Same weight-balanced split as the unit config: equal file counts are not
    // equal work, and a matrix is only as fast as its slowest leg.
    sequence: { sequencer: WeightBalancedSequencer },
    // NOTE: BUILD_TIME is NOT set for integration tests because we need real Redis/ClickHouse connections.
    // The setup.ts file handles setting the correct URLs from globalSetup.
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@ee/": join(__dirname, "./ee/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
    // ONE zod instance for the app AND linked workspace packages
    // (@langwatch/langy): zod v3 instanceof-checks its own classes (e.g.
    // z.record's key/value overload detection), so a second physical copy
    // resolved from a package's own node_modules silently mis-parses.
    dedupe: ["zod"],
  },
});
