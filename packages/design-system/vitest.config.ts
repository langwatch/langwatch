import { defineModuleVitestConfig } from "@langwatch/vitest-config";

// Each file that renders declares `@vitest-environment jsdom` in its docblock.
// Isolation stays on, as it was before this package declared a config.
export default defineModuleVitestConfig({ kind: "node", isolate: true });
