import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // This suite shares module-level singletons with what was apps/ui's shell —
  // the capability host, the feedback host, the posthog client — so a shared
  // worker lets one file's state decide another's result. See apps/ui's own
  // vitest.config.ts, which carries the same setting for the same reason.
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10_000,
  },
});
