// IMPORTANT: setupEnv MUST be imported FIRST to set CI env vars before any other code runs
// This handles CI_REDIS_URL -> REDIS_URL mapping and deletes BUILD_TIME
import "./src/server/event-sourcing/__tests__/integration/setupEnv";

import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

import WeightBalancedSequencer from "./vitest.sequencer";

config();

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
    // the files can run concurrently. CI sets both. It stays OFF by default
    // because a local run is on a machine also doing other things, and the
    // serial path is the one that has always been safe there.
    fileParallelism: process.env.VITEST_INTEGRATION_PARALLEL === "1",
    // Use forked child processes. We briefly tried pool: "threads" to
    // sidestep the post-test shard 4 wedge, but threads exposes a panic
    // in @prisma/client/query-engine-node-api when the client gets
    // constructed inside a worker-thread context (engine.rs:166 "Failed
    // to deserialize constructor options"). The wedge in forks is
    // handled by a hard-floor process.exit timer in globalSetup.ts.
    pool: "forks",
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
