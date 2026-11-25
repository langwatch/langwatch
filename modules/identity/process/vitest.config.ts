import { defineModuleVitestConfig } from "@langwatch/vitest-config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  // Fast mode's css:false breaks identity-storage-adapter-refusal-logging.unit.test.ts
  // (see vitest perf lane report); this package opts out of that one option.
  css: true,
  exclude: ["**/node_modules/**", "**/dist/**", ...repoScans],
  test: {
    watch: false,
    testTimeout: 10000,
  },
});
