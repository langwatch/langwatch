import { resolve } from "path";

import { defineConfig } from "vitest/config";

/**
 * Standalone vitest config for the governance CLI wrapper e2e suite: no
 * globalSetup/DB/endpoint, spins up a fake control-plane + gateway and
 * spawns the compiled CLI so a developer can run it in isolation.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
    // Each test spawns child processes (the compiled CLI). Forks pool
    // gives us isolated child_process workers; a threads pool blocks
    // spawnSync indefinitely.
    pool: "forks",
    // Was `poolOptions.forks.singleFork`, removed by vitest 4's pool rework
    // in favour of a top-level worker count.
    // https://v4.vitest.dev/guide/migration#pool-rework
    maxWorkers: 1,
    include: ["__tests__/e2e/cli/governance-wrapper.e2e.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
