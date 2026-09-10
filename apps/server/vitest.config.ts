import { defineModuleVitestConfig } from "../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  test: {
    fsModuleCache: true,
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
