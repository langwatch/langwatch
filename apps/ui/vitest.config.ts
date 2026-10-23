import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // This suite shares module-level singletons across files — the capability
  // host, the feedback host, the posthog client — so a shared worker lets one
  // file's state decide another's result. The failing SET changed between
  // identical runs, which is how it was found. Correctness over speed here.
  isolate: "all",
  // Every file gets a fresh module registry and jsdom window in a worker that
  // loads jsdom once, instead of a process each (ADR-184).
  isolateIn: "vm-context",
  needsOwnProcess: [
    // Loads Vite, whose native bundler rejects a vm context's String and RegExp.
    "vite/__tests__/vite-config-loader.unit.test.ts",
    // Stub `window.location`, which a vm context's window will not let go.
    "src/shell/__tests__/navigation-host.integration.test.tsx",
    "src/shell/__tests__/ui-waiting-for-api-page.integration.test.tsx",
  ],
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
