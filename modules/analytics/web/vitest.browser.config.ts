/**
 * The real-browser lane: Vega draws to canvas, loads its own grammars and
 * refuses `eval`, which jsdom cannot observe. KNOWN GAP: CI does not run
 * this lane yet — `run-package-suites.sh` only invokes `test`/`test:unit`,
 * so `test:browser` runs locally only.
 */

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/browser/**/*.browser.test.{ts,tsx}"],
    setupFiles: ["./test-setup.browser.ts"],
    testTimeout: 30_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
});
