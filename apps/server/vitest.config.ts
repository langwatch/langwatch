import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
