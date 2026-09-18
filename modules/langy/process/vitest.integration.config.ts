import { defineConfig } from "vitest/config";

/**
 * This package's integration lane: every `*.integration.test.ts` under
 * src/, excluded from the unit lane by `vitest.config.ts`. Needs Redis at
 * `LANGWATCH_TEST_REDIS_URL` (or `REDIS_URL`), else starts a container.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
