import { defineConfig } from "vitest/config";

// Plain on purpose: @langwatch/vitest-config configures this package's logger, so
// this package cannot test through it (Alex, 2026-09-27).
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    // Nine files vi.mock the logger and SDK modules; a shared graph lets one
    // file's mock decide another's result. See packages/system-migrations.
    isolate: true,
    watch: false,
    testTimeout: 10_000,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.{ts,tsx}"],
  },
});
