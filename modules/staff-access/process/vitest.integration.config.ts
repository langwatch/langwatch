import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` and the repository contract suite
 * under `src/`. The contract suite runs against Prisma when
 * `LANGWATCH_TEST_DATABASE_URL` is set, and against the memory twin either way.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["src/**/*.integration.test.ts", "src/**/*.contract.test.ts"],
    pool: "forks",
    // The Postgres suites share the test operators and the kill switch revokes every live row,
    // so files run one at a time; the script sets VITEST_MAX_WORKERS=1, which outranks this.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
