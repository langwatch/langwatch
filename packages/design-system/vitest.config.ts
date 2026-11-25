import { defineModuleVitestConfig } from "@langwatch/vitest-config";

import { repoScans } from "./vitest.repo.config.ts";

// Each file that renders declares `@vitest-environment jsdom` in its docblock.
// Isolation stays on, as it was before this package declared a config.
export default defineModuleVitestConfig({
  kind: "node",
  isolate: true,
  // Storybook's components module patches HTMLElement.prototype.focus the first
  // time it loads, so a story test that runs after another in the same registry
  // fails with "Cannot assign to read only property 'focus'". Every test that
  // reaches the Storybook preview runs isolated.
  alsoIsolate: [".storybook/**"],
  exclude: ["**/node_modules/**", "**/dist/**", ...repoScans],
});
