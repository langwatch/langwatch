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
import { graphLaneSelection } from "./src/test-utils/integrationModuleGraph";
import WeightBalancedSequencer from "./vitest.sequencer";

config();

const { datastore } = partitionIntegrationFiles({
  root: __dirname,
  searchDirs: [...INTEGRATION_SEARCH_DIRS],
});

// The datastore lane splits again, by whether a file can tolerate a shared
// module registry. `files` and `isolate` come out of ONE call on purpose:
// deriving them separately is how a lane ends up running the mocking files
// with a shared graph. See src/test-utils/integrationModuleGraph.ts.
const graphLane = graphLaneSelection({
  root: __dirname,
  datastoreFiles: datastore,
  env: process.env,
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
    include: toIncludePatterns(graphLane.files),
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
    // ISOLATION STAYS ON, and the reason is measured rather than assumed.
    //
    // Import is the largest single line item in this suite: across the six CI
    // shards it was 1,664s against 1,408s of actual test execution — 43% of
    // integration runner time, roughly 1.8s per file spent rebuilding the same
    // Prisma client and the same server graph. `isolate: false` reclaims most
    // of that, and the unit lane runs 1,688 files that way, so it looks like
    // free money.
    //
    // It is not, for this suite. Turned on, three of four CI shards went red
    // and shard 2 alone failed 30 of its 120 files, with errors that name the
    // cause: "Cannot resolve ClickHouse client", "App not initialized",
    // ECONNREFUSED. These files build and tear down an application container
    // per file, and that container is module-level state. Share the registry
    // and the first file's teardown takes the next file's client with it.
    //
    // That is not the same hazard as `fileParallelism` above — nothing here
    // runs at once — but it has the same root: this suite keeps real,
    // per-file lifecycle state in module scope. The unit and component lanes
    // do not build containers, which is why one of them can share a registry
    // and this one cannot.
    //
    // Reclaiming that 1,664s means giving the app container an explicit reset
    // between files instead of relying on a fresh module graph to provide one.
    // That is a real change to the test harness and belongs in its own PR,
    // where the failures it causes are the subject rather than collateral.
    //
    // THAT PR IS THIS ONE, and the paragraph above turned out to be half the
    // story. The teardown was one blocker and is fixed: `setup.ts` is a setup
    // FILE, so its `afterAll` ran per test file and disconnected the very
    // Prisma and Redis singletons a shared graph exists to keep.
    //
    // The other blocker is `vi.mock`, which no teardown reaches — a hoisted
    // mock cannot apply to a registry an earlier file already populated — and
    // 123 of 414 files mock a module. So the answer is a partition rather than
    // a flag: the mocking files keep a fresh registry, the rest share one.
    // Decided together with `include` above; see integrationModuleGraph.ts.
    isolate: graphLane.isolate,
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
      "~/generated/prisma/client": join(
        __dirname,
        "../../packages/prisma-client/src/generated/client.ts",
      ),
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
