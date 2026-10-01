import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // Five suites replace node:child_process and friends with vi.mock, and the
  // spawn suites need the real ones, so each file needs its own registry.
  isolate: true,
  test: {
    fsModuleCache: true,
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
