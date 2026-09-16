import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract
 * suites under `src/`. Needs Postgres — the settings roundtrip asserts jsonb
 * against real rows, and the cost ledger's suite runs against Prisma, not the memory twin.
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
