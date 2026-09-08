import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suites
 * under `src/`, both excluded from the unit lane. Needs Postgres, at
 * `DATABASE_URL` for the integration files and `LANGWATCH_TEST_DATABASE_URL`
 * for the contract suites — this is the lane where a contract suite runs its
 * cases against the Prisma repositories rather than the memory twins alone.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts", "src/**/*.contract.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
