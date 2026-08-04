// IMPORTANT: setupEnv MUST be imported FIRST to set CI env vars before any other code runs
// This handles CI_REDIS_URL -> REDIS_URL mapping and deletes BUILD_TIME
import "./src/server/event-sourcing/__tests__/integration/setupEnv";

import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

import WeightBalancedSequencer from "./vitest.sequencer";

config();

// One switch for the CI-vs-laptop trade-offs below.
const isCI = !!process.env.CI;

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
    include: ["**/*.integration.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [...configDefaults.exclude, ".next/**/*", ".next-saas/**/*"],
    testTimeout: 60_000, // 60 seconds for testcontainers startup and processing
    hookTimeout: 60_000, // 60 seconds for beforeAll/afterAll hooks
    teardownTimeout: 30_000, // 30 seconds for cleanup
    // Run test files sequentially to avoid BullMQ/Redis resource contention
    // when multiple pipelines are created and destroyed in parallel.
    //
    // Redis is the loudest: BullMQ keys a queue by name alone, so two files
    // building the same pipeline share it. Tenant-scoped ClickHouse and
    // Postgres fixtures mostly stay out of each other's way -- of the 111
    // integration files that touch ClickHouse there are five hardcoded tenant
    // ids between them, and one appears in more than one file.
    //
    // Schema-scoped fixtures are the exception, and they do not need this flag
    // to overlap: vitest starts the next file's fork before the previous file
    // has finished, so an `afterAll` and the next `beforeAll` run at once even
    // with one worker and files serial. Anything mutating shared schema takes
    // its own cross-process lock rather than trusting file order; see
    // withReplayLock in src/server/clickhouse/__tests__/migrationReplay.ts.
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
    fileParallelism: process.env.VITEST_INTEGRATION_PARALLEL === "1",
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
    // This only takes effect when fileParallelism is on. Vitest documents that
    // `fileParallelism: false` overrides maxWorkers to 1, so with the flag off
    // — which is the current state everywhere — the value here is inert, and
    // an earlier `isCI ? "100%" : 1` read as if CI were running four workers
    // when it was running one. Keep it honest: ask for two, and let vitest
    // clamp it to one while files are serial. Two rather than every core
    // because the runner has 4 vCPUs and is also hosting ClickHouse, Postgres
    // and Redis; handing vitest the whole box starved the datastores and
    // suites failed on vi.waitFor timeouts rather than on their assertions.
    maxWorkers: isCI ? 2 : 1,
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
