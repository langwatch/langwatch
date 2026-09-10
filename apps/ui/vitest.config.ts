import { defineModuleVitestConfig } from "../../packages/test-harness/src/vitest-config.ts";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    fsModuleCache: true,
    environment: "jsdom",
    watch: false,
    testTimeout: 10_000,
    // `e2e/` is the end-to-end lane: Playwright specs (`playwright test`) and
    // scenario suites that drive a real deployment through an LLM judge, each
    // with its own runner and config. Vitest's default include would collect
    // both and fail on the first `@playwright/test` import.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});
