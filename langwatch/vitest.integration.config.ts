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
    // when multiple pipelines are created and destroyed in parallel
    fileParallelism: false,
    // Use worker threads instead of forked child processes. The forks pool
    // wedged shard 4 of 6 on every run after the last test passed: dumps
    // showed the fork had no application-level handles left (handle-walker
    // unref took care of the redis singleton, coverage and json reporter
    // were ruled out as the cause), but vitest main never received the
    // fork-exit signal and sat for the full timeout cap. Threads use the
    // standard Worker exit event, which vitest main detects directly,
    // and the worker's lifecycle is in-process so the cross-process IPC
    // race that pinned forks doesn't apply.
    pool: "threads",
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
