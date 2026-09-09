import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs Postgres (`DATABASE_URL`) and Redis
 * (`CI_REDIS_URL`/`TEST_REDIS_URL`) — the blob store, DLQ and recovery
 * counter suites assert against real rows.
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
