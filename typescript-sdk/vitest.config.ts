import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 15_000,
    setupFiles: ["dotenv/config"],
    environment: "node",
  },
});
