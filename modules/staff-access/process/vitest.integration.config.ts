import { withdrawWorkerCountOverride } from "@langwatch/test-harness/integration-file-concurrency";
import { defineConfig } from "vitest/config";

// The Postgres suites share the test operators and the kill switch revokes every live row, so
// files run one at a time; a VITEST_MAX_WORKERS export would outrank fileParallelism: false.
withdrawWorkerCountOverride(process.env);

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
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
