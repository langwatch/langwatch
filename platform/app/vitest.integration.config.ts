// IMPORTANT: setupEnv MUST be imported FIRST to set CI env vars before any other code runs
// This handles CI_REDIS_URL -> REDIS_URL mapping and deletes BUILD_TIME
import "./src/server/event-sourcing/__tests__/integration/setupEnv";

import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

import { applyWorkerCap } from "./src/test-utils/workerCap";
import WeightBalancedSequencer from "./vitest.sequencer";

config();

// One switch for the CI-vs-laptop trade-offs below.
const isCI = !!process.env.CI;

// Whether a shard may run more than one file at a time. See the note on
// `fileParallelism` below for why nothing turns this on.
const fileParallelism = process.env.VITEST_INTEGRATION_PARALLEL === "1";

// The workflow sets VITEST_MAX_WORKERS to keep vitest off all four of a
// runner's vCPUs, and vitest assigns it AFTER resolving `fileParallelism:
// false` down to one worker. The cap therefore raised the floor: the
// integration shards ran two files concurrently, and the two gateway budget
// suites that replay a rollup migration collided on schema neither of them
// owns. Strip it while files are serial.
applyWorkerCap({ env: process.env, fileParallelism });

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
    // That contention is Redis-specific: BullMQ keys a queue by name alone, so
    // two files building the same pipeline share it. The ClickHouse and
    // Postgres fixtures do not have the same problem -- of the 111 integration
    // files that touch ClickHouse there are five hardcoded tenant ids between
    // them, and one appears in more than one file.
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
    fileParallelism,
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
    // Only reached when fileParallelism is on: vitest clamps maxWorkers to 1
    // while files are serial, and `applyWorkerCap` above keeps the workflow's
    // VITEST_MAX_WORKERS from undoing that clamp. Two rather than every core
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
