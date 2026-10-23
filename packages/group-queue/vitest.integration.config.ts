import { configDefaults, defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs Redis — the blob lease, blob sweeper and gq2 suites drive
 * the real queue against it. The memory-cap suite runs alone after it.
 */
export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["src/**/*.integration.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      "src/__tests__/memory-cap-script-flags.integration.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
