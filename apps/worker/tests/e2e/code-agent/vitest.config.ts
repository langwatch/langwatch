import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000, // scenario runs include an LLM judge + user simulator
    hookTimeout: 30_000,
  },
});
