import { defineConfig } from "vitest/config";

/**
 * The package runs its own tests, isolated from the application's vitest
 * config.
 *
 * Without a config here, vitest walks up to `langwatch/vitest.config.ts` and
 * inherits its global setup, which expects the application's environment. The
 * package has no application dependencies by design, so it must not acquire one
 * through the test runner.
 */
export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10000,
    // Same RAM guardrails as the application's unit config: without them
    // vitest defaults to the forks pool at `availableParallelism - 1` workers,
    // which on a developer laptop is ten forks at a few hundred MB each — and
    // several agent worktrees can be running a suite at once.
    pool: "vmForks",
    maxWorkers: process.env.CI ? "100%" : "50%",
    vmMemoryLimit: process.env.CI ? "1GB" : "512MB",
  },
});
