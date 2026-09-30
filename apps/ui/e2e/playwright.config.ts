import { defineConfig, devices } from "@playwright/test";

// The product journey lives in dev/tests/agentic-e2e now, and it signs up its own
// account, so nothing here reads a hand-saved auth.json any more.

/* Lean headless Chromium: no GPU, no anti-aliasing, no /dev/shm, capped V8 heap.
 * Leaves out --single-process/--no-zygote: they crash Chromium once a test opens a second context. */
const CHROMIUM_ARGS = [
  "--disable-gpu",
  "--disable-canvas-aa",
  "--disable-2d-canvas-clip-aa",
  "--disable-gl-drawing-for-tests",
  "--disable-dev-shm-usage",
  "--js-flags=--max-old-space-size=256",
];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./",
  // Exclude the auth-regression subfolder from `pnpm test:e2e`.
  testIgnore: ["**/auth-regression/**", "**/langy/**"],
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all projects below (playwright.dev/docs/api/class-testoptions) */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://127.0.0.1:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: CHROMIUM_ARGS } },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
  ],
});
