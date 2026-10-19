import { defineModuleVitestConfig } from "@langwatch/vitest-config";

/**
 * No `environment` here on purpose: 12 of this package's test files ask for
 * jsdom in their own docblock and 3 ask for node, so the per-file declaration
 * stays in charge and the 33 that need neither keep running in the default.
 */

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Dozens of files mock the same store and hook modules with different
  // partial shapes — isolate:false's default shared registry lets one
  // file's mock leak into the next.
  isolate: true,
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
