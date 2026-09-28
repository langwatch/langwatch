import { defineConfig } from "vitest/config";

// Drives a real Claude Code session against live model APIs.
export default defineConfig({
  test: {
    include: ["tests/**/*.scenario.test.ts"],
    testTimeout: 60 * 60 * 1000,
  },
});
