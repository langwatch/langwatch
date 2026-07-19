import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Playwright Config for E2E Tests
 *
 * Self-contained in agentic-e2e-tests/ with its own dependencies.
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

  /* Parallelism is decided per project, not globally. The headless projects
   * provision their own tenant per test and run wide; the browser project
   * still shares one org across its specs and stays serial (see below). */
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,

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

  /* Project configurations
   *
   * Tiers differ by cost, not by feature area — see
   * dev/docs/adr/010-e2e-testing-strategy.md (headless-tier amendment).
   *
   *   api / cli  Tier 3. No browser, no shared state: every test provisions
   *              its own org + project over HTTP, so they run fully parallel
   *              and are eligible to block a PR.
   *   ui         Tier 2. The capped 5-10 browser happy paths.
   */
  projects: [
    /* Headless: HTTP-level assertions against a real app, queues and DB. */
    {
      name: "api",
      testDir: "./tests/api",
      /* No `use` block on purpose — these tests never touch a `page`, so no
       * browser is launched for this project. */
    },

    /* Headless: spawns the real CLI binary against a temp HOME. */
    {
      name: "cli",
      testDir: "./tests/cli",
    },

    /* Setup project - runs authentication once for the browser tier */
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    /* Browser tier - uses authenticated state.
     *
     * Still serial. Its specs share the one `auth.setup` org, and the members
     * specs toggle an enterprise licence on it, which would leak into
     * settings/plans-comparison.spec.ts asserting the Free plan. The per-test
     * tenant helper in tests/support/tenant.ts is what will unblock
     * parallelising this too, once these specs are migrated onto it. */
    {
      name: "ui",
      testDir: "./tests",
      testIgnore: ["**/api/**", "**/cli/**", "**/*.setup.ts"],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_FILE,
      },
      dependencies: ["setup"],
    },

    /* Note: Firefox removed due to flakiness (NS_BINDING_ABORTED errors)
     * Chromium provides sufficient coverage for our use case */
  ],

  /* Global timeout */
  timeout: 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Output directory for test artifacts */
  outputDir: "./test-results",
});
