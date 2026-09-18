import { defineConfig } from "vitest/config";

/**
 * Integration lane for contract suites and `*.integration.test.ts`. Repositories
 * read rows other features own; contract suite registers memory twin only.
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
