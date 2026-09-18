import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  test: {
    fsModuleCache: true,
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
