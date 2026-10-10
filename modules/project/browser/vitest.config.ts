import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Several files mock the same module with different partial shapes —
  // isolate:false's default shared registry lets one file's mock leak into
  // the next.
  isolate: true,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
