import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  include: ["_tests/**/*.scenario.test.ts"],
  testTimeout: 60 * 60 * 1000,
  test: {
    // Sweeps the workspaces the scenarios leave in the system temp folder.
    // Each one carries an installed node_modules or .venv, so without this a
    // run of the whole suite leaves tens of gigabytes behind.
    globalSetup: ["./_tests/helpers/temp-workdir-teardown.ts"],
  },
});
