import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60 * 60 * 1000, // 1 hour
    // Sweeps the workspaces the scenarios leave in the system temp folder.
    // Each one carries an installed node_modules or .venv, so without this a
    // run of the whole suite leaves tens of gigabytes behind.
    globalSetup: ["./_tests/helpers/temp-workdir-teardown.ts"],
  },
});
