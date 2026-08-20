import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    setupFiles: ["dotenv/config", "./test-setup.ts"],
    environment: "node",
    include: ["src/**/*.test.ts", "!src/**/*.e2e.test.ts"],
    exclude: ["examples/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
