import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Two screens mock the same `scim-api.ts`, and a shared module graph hands
  // the second file the first one's registration.
  isolate: true,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
