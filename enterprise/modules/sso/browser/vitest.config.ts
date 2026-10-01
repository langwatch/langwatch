import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Three files mock `behavior/sso-api.ts` with a recorder each, and with the
  // registry shared one file's factory answers another's imports.
  isolate: true,
  test: {
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 30_000,
  },
});
