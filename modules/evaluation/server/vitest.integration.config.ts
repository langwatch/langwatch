import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suites
 * under `src/`. Needs Postgres — the evaluator settings roundtrip asserts jsonb
 * config against real rows at `DATABASE_URL`, and the cost ledger's contract
 * suite runs its cases against the Prisma repository at
 * `LANGWATCH_TEST_DATABASE_URL` rather than the memory twin alone.
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
