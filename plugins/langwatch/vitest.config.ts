import { defineConfig } from "vitest/config";

/**
 * The suite is two files: JSON contract assertions, and one that spawns the
 * bundled hook against a local collector. Both are node-only, neither needs a
 * service.
 *
 * The worker cap is the point of having this file at all. Vitest's default is
 * one fork per core minus one, which on a developer laptop running several
 * worktrees at once is several gigabytes of resident processes for two test
 * files. Two is enough to keep the files parallel.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    maxWorkers: 2,
    // The bundle is built on demand in `beforeAll` when it is missing, which is
    // a tsup run rather than a test.
    hookTimeout: 320_000,
    testTimeout: 30_000,
  },
});
