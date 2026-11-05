/**
 * Real-Chromium lane: paint order is something jsdom cannot observe.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";
import { mergeConfig } from "vitest/config";

// The shader package is only reached through a mocked import, so the optimiser finds it
// after the first run starts, reloads, and fails the file on a cold cache.
export default mergeConfig(defineBrowserVitestConfig(), {
  optimizeDeps: { include: ["@paper-design/shaders-react"] },
});
