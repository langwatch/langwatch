import { defineModuleVitestConfig } from "@langwatch/vitest-config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: false,
  exclude: ["**/node_modules/**", "**/dist/**", ...repoScans],
  test: {
    watch: false,
    // The package's only suite is a repo scan, which runs as `test:repo`.
    passWithNoTests: true,
    testTimeout: 10_000,
  },
});
