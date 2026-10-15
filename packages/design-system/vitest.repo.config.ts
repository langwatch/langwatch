import { defineConfig } from "vitest/config";

// The suites that walk the whole source tree. They run uncached as `test:repo`, so an
// edit anywhere does not miss the `test` cache (ADR-150).
export const repoScans = [
  "tests/browser-raw-colours.unit.test.ts",
  "tests/no-raw-error-toasts.unit.test.ts",
  "tests/storybook-showcase.unit.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    include: repoScans,
    watch: false,
    testTimeout: 60_000,
  },
});
