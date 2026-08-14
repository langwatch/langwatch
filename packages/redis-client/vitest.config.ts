import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10000,
    // These tests are pure — no container, no socket, no DOM. Capping the pool
    // keeps a run cheap when it overlaps every other worktree's checks on the
    // same machine; vitest would otherwise default to one fork per core.
    maxWorkers: 2,
  },
});
