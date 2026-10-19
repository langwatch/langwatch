import { defineConfig } from "vitest/config";

// Plain on purpose: clickhouse-client depends on this package, which takes no workspace config.
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
