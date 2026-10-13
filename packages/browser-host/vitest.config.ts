import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Two suites replace modules with vi.mock, so each file needs its own registry.
  isolate: true,
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
