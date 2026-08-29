import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    testTimeout: 10000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
