import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suites
 * under `src/`. Needs Postgres, at `LANGWATCH_TEST_DATABASE_URL` — this is the
 * lane where the contract suite runs its cases against the Prisma repository
 * rather than the memory twin alone. The memory cases run here too, which is
 * what makes the two answers comparable in one report.
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
