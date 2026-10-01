import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type ViteUserConfig } from "vitest/config";

/**
 * The real-browser lane. Its own module so the jsdom builder every package
 * imports does not name the Playwright provider on all of their installs.
 * See dev/docs/best_practices/browser-test-lane.md for when to reach for it.
 */

/** Where the lane's files live. Kept in one place so CI and the guard agree. */
export const BROWSER_TEST_GLOB = "**/*.browser.test.{ts,tsx}";

/** The npm script every package declaring the lane exposes. CI reads it. */
export const BROWSER_TEST_SCRIPT = "test:browser";

export interface BrowserVitestConfigOptions {
  /** Overrides the default glob; the guard reads the same value. */
  include?: string[];
  exclude?: string[];
  setupFiles?: string[];
  /** Real browsers are slower than jsdom for the same work. */
  testTimeout?: number;
  /** Merged over everything above. */
  test?: ViteUserConfig["test"];
}

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

export function defineBrowserVitestConfig(
  options: BrowserVitestConfigOptions = {},
): ViteUserConfig {
  const { include, exclude, setupFiles, testTimeout, test } = options;
  return defineConfig({
    test: {
      include: include ?? [BROWSER_TEST_GLOB],
      exclude: exclude ?? DEFAULT_EXCLUDE,
      // A browser lane that collects nothing exits 0 and reads as a pass;
      // both packages that hand-rolled this lane did exactly that. Vitest's
      // own flag is what turns an empty collection into a failure.
      passWithNoTests: false,
      watch: false,
      // A real engine pays for layout and paint on every interaction, so the
      // jsdom budget is not the right one. Overridable per package.
      testTimeout: testTimeout ?? 30_000,
      ...(setupFiles ? { setupFiles } : {}),
      browser: {
        enabled: true,
        provider: playwright(),
        headless: true,
        instances: [{ browser: "chromium" }],
      },
      ...test,
    },
  });
}
