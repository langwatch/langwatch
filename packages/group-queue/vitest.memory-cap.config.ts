import { defineConfig } from "vitest/config";

/**
 * The memory-cap suite, run after the integration lane and never beside it: it lowers the
 * Redis server's `maxmemory`, which would refuse every other suite's writes while it is low
 * (specs/memory-cap-script-flags.feature).
 */
export default defineConfig({
  test: {
    include: ["src/__tests__/memory-cap-script-flags.integration.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
