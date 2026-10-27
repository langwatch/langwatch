import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "node",
  // convergence.unit.test.ts mocks `@langwatch/observability`, and the shared
  // default shares one module graph per worker: whichever file imports
  // convergence.ts first decides whether its module-level logger is the mock.
  isolate: true,
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
