import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suite
 * under `src/`. The contract suite runs its cases against the Prisma
 * repository when `LANGWATCH_TEST_DATABASE_URL` names a database, and against
 * the memory twin either way — which is what makes the two answers comparable
 * in one report.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts", "src/**/*.contract.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
