/**
 * Real-Chromium lane: Vega draws to canvas and refuses `eval`, neither of
 * which jsdom can observe. No setup file — `@vitest/browser` supplies the
 * jest-dom matcher set itself, which is all this lane's setup ever did.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";
import { mergeConfig } from "vitest/config";

// Monaco is only reached through a mocked import, so the optimiser finds it
// after the first run starts, reloads, and fails the file on a cold cache.
export default mergeConfig(defineBrowserVitestConfig(), {
  optimizeDeps: { include: ["@monaco-editor/react"] },
});
