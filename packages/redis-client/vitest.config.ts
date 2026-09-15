import { configDefaults } from "vitest/config";
import { defineModuleVitestConfig } from "../test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    watch: false,
    testTimeout: 10000,
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
    // These tests are pure — no container, no socket, no DOM. Capping the pool
    // keeps a run cheap when it overlaps every other worktree's checks on the
    // same machine; vitest would otherwise default to one fork per core.
    maxWorkers: 2,
  },
});
