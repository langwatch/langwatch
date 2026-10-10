import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 10000,
    maxWorkers: 1,
  },
});
