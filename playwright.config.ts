import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Root Playwright Config
 *
 * This config exists for the Playwright MCP tools and direct test runs.
 * Tests live in agentic-e2e-tests/tests/
 *
 * Usage:
 *   pnpm exec playwright test
 *   pnpm exec playwright test --ui
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5560";
const AUTH_FILE = path.join(__dirname, "agentic-e2e-tests", ".auth", "user.json");
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./agentic-e2e-tests/tests",

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
    ["html", { outputFolder: "agentic-e2e-tests/playwright-report" }],
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

    /* Firefox for cross-browser coverage (CI only) */
    ...(IS_CI
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
  outputDir: "agentic-e2e-tests/test-results",
});
