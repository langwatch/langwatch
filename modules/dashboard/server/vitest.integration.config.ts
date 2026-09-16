import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract
 * suites under `src/`. Needs Postgres — persistence suites assert real rows,
 * and contract suites run against Prisma too, so the two answers are comparable.
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
