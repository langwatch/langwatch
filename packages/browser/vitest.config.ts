import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // This suite shares module-level singletons with what was apps/ui's shell —
  // the capability host, the feedback host, the posthog client — so a shared
  // worker lets one file's state decide another's result.
  isolate: "all",
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
