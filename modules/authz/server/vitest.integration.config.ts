import { defineConfig } from "vitest/config";

// Integration lane for .integration.test.ts; needs Postgres for real statistics.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
