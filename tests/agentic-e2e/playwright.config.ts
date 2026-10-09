import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright Config for E2E Tests
 *
 * Self-contained in tests/agentic-e2e/ with its own dependencies.
 *
 * Usage:
 *   pnpm test
 *   pnpm test:ui
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const AUTH_FILE = path.join(__dirname, ".auth", "user.json");
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",

  /* Global setup - validates environment before running tests */
  globalSetup: require.resolve("./tests/global-setup.ts"),

  /* Ignore the MCP seed file - it's only for planning exploration */
  testIgnore: ["**/seed.spec.ts"],

  /* Run tests sequentially - important for agentic debugging */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: IS_CI,

  /* Retry on CI only */
  retries: IS_CI ? 2 : 0,

  /* Reporter configuration */
  reporter: [
    ["html", { outputFolder: "./playwright-report" }],
    ["list"],
  ],

  /* Shared settings for all projects */
  use: {
    baseURL: BASE_URL,

    /* Quiet every animation that honours prefers-reduced-motion. The auth
     * screens paint a live shader ground and a one-shot entrance, and both
     * stand down under this setting (AuthGround, LogoHandoff, the tweened
     * ground). Without it the perpetual ground keeps interactive elements
     * from ever settling, so Playwright's "visible, enabled and stable"
     * actionability wait on a button never resolves and the click times out.
     * This became load-bearing when the ground stopped being hosted-only and
     * started rendering on the self-hosted (non-IS_SAAS) surface CI runs. */
    reducedMotion: "reduce",

    /* In CI, use the runner's preinstalled Google Chrome
     * (E2E_BROWSER_CHANNEL=chrome) to skip the ~170 MB Chromium download.
     * Locally it falls back to Playwright's bundled Chromium. Applies to all
     * projects (setup + specs) since none override channel. */
    ...(process.env.E2E_BROWSER_CHANNEL
      ? { channel: process.env.E2E_BROWSER_CHANNEL }
      : {}),

    /* Collect trace on failure for debugging */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    /* Video needs Playwright's own pinned ffmpeg binary, which the bundled
     * Chromium download would normally supply. We skip that download in CI
     * (system Chrome via channel), so video is opt-in via E2E_RECORD_VIDEO to
     * avoid a separate ffmpeg install. Trace already captures DOM, network,
     * and console for debugging. */
    video: process.env.E2E_RECORD_VIDEO ? "retain-on-failure" : "off",

    /* Reasonable timeouts */
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  /* Start test environment via Docker Compose (local only, CI uses services)
   * Note: Run `docker compose -f compose.test.yml up -d` manually before tests
   * The webServer is disabled to avoid complexity with container lifecycle
   */
  webServer: undefined,

  /* Project configurations */
  projects: [
    /* Setup project - runs authentication once */
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    /* Main test project - uses authenticated state */
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_FILE,
      },
      dependencies: ["setup"],
    },

    /* Note: Firefox removed due to flakiness (NS_BINDING_ABORTED errors)
     * Chromium provides sufficient coverage for our use case */
  ],

  /* Whole-test budget. This is a SUM, not a hang detector: `actionTimeout`
   * and `navigationTimeout` above are what catch a genuinely stuck step, and
   * they are unchanged, so a hang still fails at the step in 15-30s either
   * way. What this bounds is how many steps one test may spend.
   *
   * The front-door journeys sign a fresh account in through the real screens,
   * and on a CI runner (software-rendered Chrome, no GPU) every Playwright
   * actionability check costs several hundred milliseconds — a single
   * `Continue` click measures ~4.2s there against well under a second
   * locally, spread evenly over resolve/stable/scroll/click/navigate rather
   * than stuck on any one of them.
   *
   * At 60s that tax left passkeys passing with 7s to spare and the
   * no-display-name sign-up flaky. Both needed more than 60s on the very next
   * run (72s and 60s), which is the measurement this number answers; the
   * runner's speed swings enough between runs — 14.4 and 18.7 minutes for the
   * same suite on the same code — that a budget sitting just above the last
   * good figure is red again on the next one.
   *
   * One test is long enough that this is still not the right lever, and it
   * says so itself with `test.slow()` rather than pushing this up for
   * everybody. Local keeps the tighter budget, which is where a newly-slow
   * test should be noticed. */
  timeout: IS_CI ? 120000 : 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Output directory for test artifacts */
  outputDir: "./test-results",
});
