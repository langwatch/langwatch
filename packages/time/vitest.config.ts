import { defineConfig } from "vitest/config";

// Plain on purpose: @langwatch/observability depends on this package and
// @langwatch/vitest-config on observability (Alex, 2026-09-27).
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    isolate: false,
    watch: false,
    testTimeout: 10_000,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.{ts,tsx}"],
  },
});
