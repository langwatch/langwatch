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
  },
});
