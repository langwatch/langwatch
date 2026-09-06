import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * The guided onboarding end-to-end run: a fresh sign-up in a real browser,
 * against a running local stack. It signs up its own users, so it carries
 * no stored auth state (which is why it is not part of the default config),
 * and it records video of every run: the guided run is the first half of the
 * feature's demo clip.
 *
 * Run:
 *   GUIDED_E2E_BASE_URL=http://localhost:5600 pnpm test:e2e:guided
 *
 * The stack must force `experiment_onboarding_langy_guided` on, or the
 * browser override (`?ff_...=on`) the spec sets must be allowed. The OpenAI
 * key comes from OPENAI_API_KEY or platform/app/.env and is never printed.
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
  outputDir: path.resolve(
    __dirname,
    "../../../.claude/tmp/guided-onboarding/video/test-results",
  ),
  use: {
    baseURL: process.env.GUIDED_E2E_BASE_URL ?? "http://localhost:5600",
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
