import { defineModuleVitestConfig } from "../../../packages/test-harness/src/vitest-config.ts";

/**
 * No `environment` here on purpose: 12 of this package's test files ask for
 * jsdom in their own docblock and 3 ask for node, so the per-file declaration
 * stays in charge and the 33 that need neither keep running in the default.
 */

export default defineModuleVitestConfig({
  kind: "jsdom",
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
