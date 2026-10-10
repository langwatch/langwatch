import path from "path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Config for E2E Tests Self-contained in dev/tests/agentic-e2e/ with its own
 * dependencies. Usage: pnpm test pnpm test:ui
 */

/**
 * The workspace `.env`, resolved from the repository root the way every application resolves
 * it.
 */
function loadWorkspaceEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  try {
    process.loadEnvFile(path.join(__dirname, "..", "..", "..", ".env"));
  } catch {
    // No workspace .env here; the shell is the whole environment.
  }
}

loadWorkspaceEnv();

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5570";
const AUTH_FILE = path.join(__dirname, ".auth", "user.json");
const IS_CI = !!process.env.CI;

/* Lean headless Chromium: no GPU, no anti-aliasing, no /dev/shm, capped V8 heap.
 * Leaves out --single-process/--no-zygote: they crash Chromium once a test opens a second
 * context. */
const CHROMIUM_ARGS = [
  "--disable-gpu",
  "--disable-canvas-aa",
  "--disable-2d-canvas-clip-aa",
  "--disable-gl-drawing-for-tests",
  "--disable-dev-shm-usage",
  "--js-flags=--max-old-space-size=256",
];

export default defineConfig({
  testDir: "./tests",

  /* Global setup - validates environment before running tests. The unit project needs no
   * stack, and globalSetup is config-wide, so `test:unit` sets E2E_UNIT to skip it. */
  globalSetup: process.env.E2E_UNIT ? undefined : require.resolve("./tests/global-setup.ts"),

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
  reporter: [["html", { outputFolder: "./playwright-report" }], ["list"]],

  /* Shared settings for all projects */
  use: {
    baseURL: BASE_URL,

    /* In CI, use the runner's preinstalled Google Chrome
     * (E2E_BROWSER_CHANNEL=chrome) to skip the ~170 MB Chromium download.
     * Locally it falls back to Playwright's bundled Chromium. Applies to all
     * projects (setup + specs) since none override channel. */
    ...(process.env.E2E_BROWSER_CHANNEL ? { channel: process.env.E2E_BROWSER_CHANNEL } : {}),

    /* Collect trace on failure for debugging */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    /* Video needs Playwright's own pinned ffmpeg binary, which the bundled
     * Chromium download would normally supply. We skip that download in CI
     * (system Chrome via channel), so video is opt-in via E2E_RECORD_VIDEO to
     * avoid a separate ffmpeg install. Trace already captures DOM, network,
     * and console for debugging. */
    video: process.env.E2E_RECORD_VIDEO ? "retain-on-failure" : "off",

    reducedMotion: "reduce",
    launchOptions: { args: CHROMIUM_ARGS },

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
    /* Pure unit tests of the suite's own helpers: no stack, no setup dependency */
    {
      name: "unit",
      testMatch: /.*\.unit\.test\.ts/,
    },

    /* Setup project - runs authentication once */
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    /* The product journey - signs up its own account, so no shared state */
    {
      name: "journey",
      testDir: "./tests/journey",
      // A simulation run is queued, forked and judged, so the legs that wait on
      // one need minutes, not the suite's default minute.
      timeout: 600000,
      use: {
        ...devices["Desktop Chrome"],
        // The journey drives a dev-mode stack that compiles a route's chunk on
        // first request, on a machine that is usually running other work.
        actionTimeout: 30000,
        navigationTimeout: 120000,
      },
    },

    /* SSO journeys against idpsim: each signs up its own administrator, so no shared state */
    {
      name: "sso",
      testDir: "./tests/sso",
      timeout: 300000,
      use: { ...devices["Desktop Chrome"], actionTimeout: 30000, navigationTimeout: 120000 },
    },

    /* Licence journeys: each spec refuses a stack in the wrong deployment mode */
    {
      name: "licence",
      testDir: "./tests/licence",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },

    /* Main test project - uses authenticated state */
    {
      name: "chromium",
      testIgnore: ["**/journey/**", "**/sso/**", "**/licence/**", "**/*.unit.test.ts"],
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
