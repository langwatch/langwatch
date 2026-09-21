import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
