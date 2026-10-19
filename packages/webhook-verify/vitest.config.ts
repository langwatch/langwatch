import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    environment: "node",
    testTimeout: 10000,
  },
});
