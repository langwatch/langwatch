import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Only the files that mock modules run isolated (testing-speed.md). The rest
  // share a worker and its jsdom window, so a test that changes a global
  // (navigator, document, a module singleton) puts it back afterwards.
  isolate: true,
  // The isolated files get a fresh module registry and jsdom window in a worker
  // that loads jsdom once, instead of a process each (ADR-184).
  isolateIn: "vm-context",
  test: {
    fsModuleCache: true,
    environment: "jsdom",
    watch: false,
    testTimeout: 10_000,
    // `e2e/` is the end-to-end lane: Playwright specs (`playwright test`) and
    // scenario suites that drive a real deployment through an LLM judge, each
    // with its own runner and config. Vitest's default include would collect
    // both and fail on the first `@playwright/test` import. `scripts/__tests__`
    // holds node:test suites the build job runs with `node --test`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "scripts/__tests__/**"],
  },
});
