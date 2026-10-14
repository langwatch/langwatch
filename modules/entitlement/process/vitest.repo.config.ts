import { defineConfig } from "vitest/config";

// The suites that walk the whole source tree. They run uncached as `test:repo`, so an
// edit anywhere does not miss the `test` cache (ADR-150).
export const repoScans = ["src/__tests__/entitlement-boundary.unit.test.ts"];

export default defineConfig({
  test: {
    environment: "node",
    include: repoScans,
    watch: false,
    testTimeout: 60_000,
  },
});
