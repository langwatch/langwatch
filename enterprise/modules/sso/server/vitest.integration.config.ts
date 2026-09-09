import { defineConfig } from "vitest/config";

/**
 * Integration lane: `*.integration.test.ts` under `src/`, excluded from the
 * unit lane. Needs no datastore -- the only boundary these suites stand up is
 * an identity provider, in this process, on a loopback port.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    pool: "forks",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
});
