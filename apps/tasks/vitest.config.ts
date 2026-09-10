import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    watch: false,
    testTimeout: 10000,
  },
});
