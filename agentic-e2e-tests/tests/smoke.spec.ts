import { test, expect } from "@playwright/test";

import { getProjectSlug } from "./helpers";

/**
 * Smoke Tests
 *
 * Basic sanity checks that run after authentication setup.
 * These verify infrastructure is working, not user behavior.
 */

test("app loads after authentication", async ({ page }) => {
  await page.goto("/");

  // Verify we're not redirected to login
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  // The app is functional if it redirects to a project route (the personal
  // portal landing) rather than bouncing to login. getProjectSlug throws if
  // it never reaches one.
  await getProjectSlug(page);
});
