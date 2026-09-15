import { defineConfig } from "vitest/config";

/** Integration lane for *.integration.test.ts; needs Postgres at DATABASE_URL. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
