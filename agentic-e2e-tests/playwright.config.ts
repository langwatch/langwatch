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

    /* Collect trace on failure for debugging */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

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

  /* Global timeout */
  timeout: 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Output directory for test artifacts */
  outputDir: "./test-results",
});
