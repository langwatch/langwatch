import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60 * 60 * 1000, // 1 hour
  },
});
