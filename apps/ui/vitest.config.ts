import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // This suite shares module-level singletons across files — the capability
  // host, the feedback host, the posthog client — so a shared worker lets one
  // file's state decide another's result. The failing SET changed between
  // identical runs, which is how it was found. Correctness over speed here.
  isolate: true,
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
