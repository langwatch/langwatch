// IMPORTANT: setupEnv MUST be imported FIRST to set CI env vars before any other code runs
// This handles CI_REDIS_URL -> REDIS_URL mapping and deletes BUILD_TIME
import "./src/server/event-sourcing/__tests__/integration/setupEnv";

import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

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
    exclude: [
      ...configDefaults.exclude,
      ".next/**/*",
      ".next-saas/**/*",
    ],
    testTimeout: 60_000, // 60 seconds for testcontainers startup and processing
    hookTimeout: 60_000, // 60 seconds for beforeAll/afterAll hooks
    teardownTimeout: 30_000, // 30 seconds for cleanup
    // Run test files sequentially to avoid BullMQ/Redis resource contention
    // when multiple pipelines are created and destroyed in parallel. Use
    // maxWorkers/minWorkers (NOT `fileParallelism: false`) because the
    // coverage module reads `!fileParallelism` as "treat this run as
    // singleFork" -- it then groups every file into one long-lived fork,
    // which is what caused the integration shard to wedge post-test once
    // v8 coverage data accumulated past the heap (see #4417). maxWorkers:1
    // gives the same sequential guarantee with a fresh fork per file.
    maxWorkers: 1,
    minWorkers: 1,
    // Run integration files in forked child processes (vs the unit pool's
    // `vmThreads`) so each worker is force-killed on file exit. With vmThreads
    // a single un-`unref`'d timer or unclosed client in any file makes the
    // whole shard wait forever under --coverage (which awaits a graceful
    // worker exit instead of force-killing the pool); forks side-step that
    // class of hang entirely. The startup cost is a few hundred ms per file,
    // which is dwarfed by integration tests' actual work.
    pool: "forks",
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
  },
});
