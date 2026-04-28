import { join } from "path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Browser-mode tests run inside a real Chromium via Playwright. Use these for
 * components whose behaviour depends on browser APIs jsdom doesn't implement
 * (ProseMirror selection, layout-driven decorations, real keyboard events).
 *
 * Files matching `*.browser.test.tsx` are picked up here and excluded from
 * the default `test:unit` runner.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}"],
    setupFiles: ["./test-setup.browser.ts"],
    testTimeout: 30000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
    env: {
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
  },
});
