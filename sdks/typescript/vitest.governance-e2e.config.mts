import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Standalone vitest config for the governance CLI wrapper e2e suite.
 * NO globalSetup, NO DB, NO LangWatch endpoint required — the tests
 * spin up their own fake control-plane + fake gateway in-process and
 * spawn the compiled CLI as a child process. Lets a developer run the
 * suite in isolation without standing up the full LangWatch stack.
 *
 * (The suite also runs under the main `vitest.e2e.config.mts` in CI
 * via the broader `**\/*.e2e.test.ts` include — the standalone config
 * is purely a dev-loop convenience.)
 *
 * testTimeout bumped to 30s for cold-start + child-spawn overhead.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: "node",
    // Each test spawns child processes (the compiled CLI). Forks pool
    // gives us isolated child_process workers; the default threads
    // pool blocks spawnSync indefinitely.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    include: ["__tests__/e2e/cli/governance-wrapper.e2e.test.ts"],
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
