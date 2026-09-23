import { defineConfig } from "vitest/config";

/** The receipt race suite: needs Postgres at `LANGWATCH_TEST_DATABASE_URL`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
