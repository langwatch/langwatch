import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Agentic E2E Tests Configuration
 *
 * This config is used by:
 * - Playwright Test Planner agent (exploration)
 * - Playwright Test Generator agent (test creation)
 * - Playwright Test Healer agent (debugging/fixing)
 * - CI pipeline (regression testing)
 */

/**
 * Test Environment Configuration
 *
 * Uses separate ports to avoid interfering with local development:
 * - App: 5561 (dev uses 5560)
 * - Postgres: 5433 (dev uses 5432)
 * - Redis: 6380 (dev uses 6379)
 * - Elasticsearch: 9201 (dev uses 9200)
 */
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5561";
const AUTH_FILE = path.join(__dirname, ".auth", "user.json");

export default defineConfig({
  testDir: "./tests",

  /* Run tests sequentially - important for agentic debugging */
  fullyParallel: false,
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Reporter configuration */
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
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

    /* Firefox for cross-browser coverage (CI only) */
    ...(process.env.CI
      ? [
          {
            name: "firefox",
            use: {
              ...devices["Desktop Firefox"],
              storageState: AUTH_FILE,
            },
            dependencies: ["setup"],
          },
        ]
      : []),
  ],

  /* Global timeout */
  timeout: 60000,

  /* Expect timeout */
  expect: {
    timeout: 10000,
  },

  /* Output directory for test artifacts */
  outputDir: "test-results",
});
