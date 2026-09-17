import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`. The schema-lock
 * file spawns real processes and the aggregating-dimension file reads a
 * migrated ClickHouse back, so neither may share a worker with anything else.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
