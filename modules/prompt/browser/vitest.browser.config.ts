/** Real-Chromium lane: the prompt studio's compare layout, which jsdom cannot measure. */

import { defineBrowserVitestConfig } from "@langwatch/vitest-config/browser";

export default defineBrowserVitestConfig({ setupFiles: ["./vitest.setup.ts"] });
