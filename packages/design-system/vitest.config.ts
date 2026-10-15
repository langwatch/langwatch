import { defineModuleVitestConfig } from "@langwatch/vitest-config";

import { repoScans } from "./vitest.repo.config.ts";

// Each file that renders declares `@vitest-environment jsdom` in its docblock.
// Isolation stays on, as it was before this package declared a config.
export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  exclude: ["**/node_modules/**", "**/dist/**", ...repoScans],
});
