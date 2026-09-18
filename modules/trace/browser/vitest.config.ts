import { defineModuleVitestConfig } from "@langwatch/test-harness/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Dozens of files now mock the shared `@langwatch/trace-browser-kit`
  // specifier with different partial shapes (it folds what used to be many
  // independently-mocked store files) — isolate:false's default shared
  // registry lets one file's mock leak into the next.
  isolate: true,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // `*.browser.test.tsx` is the real-browser lane the explorer's editor
    // suites were written for — a contenteditable caret is not a thing jsdom
    // has. `platform/app` ran them from a separate `vitest.browser.config.ts`
    // and CI did not run that either; excluding them here keeps the default
    // lane honest rather than red for a reason it cannot fix.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.{ts,tsx}"],
    // The explorer suites drive real user events through Chakra overlays and a
    // virtualised table; the slowest of them clears five seconds while passing
    // comfortably alone, so the budget reflects the suite, not the default.
    testTimeout: 30_000,
  },
});
