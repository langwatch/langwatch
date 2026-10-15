import { defineModuleVitestConfig } from "@langwatch/vitest-config";

import { repoScans } from "./vitest.repo.config.ts";

export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  exclude: ["**/node_modules/**", "**/dist/**", ...repoScans],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
  },
});
