import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Its suites replace modules with vi.mock, so each file needs its own registry.
  isolate: true,
  // A lent table's first lazy import compiles its whole screen, which clears
  // the 5s default under a loaded worker pool; same budget annotation-web took.
  testTimeout: 30_000,
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
});
