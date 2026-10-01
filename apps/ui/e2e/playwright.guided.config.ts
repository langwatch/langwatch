import path from "path";

import { defineConfig, devices } from "@playwright/test";

/**
 * The guided onboarding e2e run: fresh sign-ups against a local stack, no stored auth, video
 * recorded. Run with `GUIDED_E2E_BASE_URL=http://localhost:5600 pnpm test:e2e:guided` and the
 * guided flag on.
 */
export default defineConfig({
  testDir: "./",
  testMatch: ["**/guided-onboarding.e2e.test.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: path.resolve(__dirname, "../../../.claude/tmp/guided-onboarding/video/test-results"),
  use: {
    baseURL: process.env.GUIDED_E2E_BASE_URL ?? "http://localhost:5600",
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
