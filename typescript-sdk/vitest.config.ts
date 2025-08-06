import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["dotenv/config"],
    environment: "node",
  },
});
