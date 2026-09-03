/**
 * The real-browser lane.
 *
 * Vega draws to a canvas, loads its own grammars and refuses `eval`; four of
 * this package's guarantees are only true in a browser, and jsdom cannot
 * observe any of them. These files came from
 * `platform/app/src/features/analytics-query/__tests__` with the workbench, and
 * they are configured here the way that application configured them.
 *
 * KNOWN GAP, STATED RATHER THAN HIDDEN: CI does not run this lane yet.
 * `.github/scripts/run-package-suites.sh` invokes a package's `test:unit` or
 * `test` script and nothing else, so `pnpm --filter @langwatch/analytics-web
 * test:browser` runs locally and nowhere else. Closing it is one step in
 * `langwatch-app-ci.yml` beside the application's own browser lane, which is a
 * CI decision rather than a page move's — and the alternative, deleting four
 * real-browser guarantees because there is nowhere to run them, is worse.
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
