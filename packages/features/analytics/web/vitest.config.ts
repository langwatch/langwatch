import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Per-file rather than global: the visualization and model suites are pure
    // and run faster without a DOM, and every file that renders declares
    // `@vitest-environment jsdom` in its own docblock.
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The real-browser lane is its own config and its own script; without this
    // the default runner picks those files up and fails them on a `vitest/browser`
    // import jsdom cannot answer.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/browser/**"],
    // The screen suites drive real user events through Chakra overlays and
    // recharts; under a fully loaded worker pool the slowest of them clears 5s
    // while passing comfortably alone, so the budget reflects the suite rather
    // than the default. The same budget gateway-web, automation-web, agent-web
    // and annotation-web took.
    testTimeout: 30_000,
  },
});
