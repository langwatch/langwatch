/**
 * Real-Chromium lane: Vega draws to canvas and refuses `eval`, neither of
 * which jsdom can observe. No setup file — `@vitest/browser` supplies the
 * jest-dom matcher set itself, which is all this lane's setup ever did.
 */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";

export default defineBrowserVitestConfig();
