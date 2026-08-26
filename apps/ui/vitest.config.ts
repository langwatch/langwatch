import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    watch: false,
    testTimeout: 10_000,
  },
});
