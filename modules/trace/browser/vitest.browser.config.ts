/**
 * Real-Chromium lane: layout and keyboard behaviour jsdom cannot answer, such
 * as the Add to Dataset preview scrolling and its cell editor's Escape.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";

export default defineBrowserVitestConfig({ setupFiles: ["./vitest.setup.ts"] });
