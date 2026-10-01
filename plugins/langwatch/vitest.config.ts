import { defineModuleVitestConfig } from "@langwatch/vitest-config";

/** Two workers keep this node-only suite parallel without excess memory. */

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    maxWorkers: 2,
    // The CLI dist is built on demand in `beforeAll` when it is missing, which
    // is a tsup run rather than a test.
    hookTimeout: 320_000,
    testTimeout: 30_000,
  },
});
