import { test, expect } from "@playwright/test";

import { getProjectSlug } from "./helpers";

/**
 * Smoke Tests
 *
 * Basic sanity checks that run after authentication setup.
 * These verify infrastructure is working, not user behavior.
 */

test("app loads after authentication", async ({ page }) => {
  // Derive a real project deterministically, independent of persona-based root
  // routing (a personal-persona user lands on /me, not a project route).
  const slug = await getProjectSlug(page);

  await page.goto(`/${slug}/messages`);

  // Verify we're not bounced to login and the authenticated shell renders.
  await expect(page).not.toHaveURL(/\/auth\/signin/);
  await expect(page.locator('a[href="/settings"]').first()).toBeVisible({
    timeout: 30000,
  });
});
