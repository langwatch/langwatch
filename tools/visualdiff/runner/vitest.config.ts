import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10_000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
