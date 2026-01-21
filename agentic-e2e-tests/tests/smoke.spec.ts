import { test, expect } from "@playwright/test";

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

  // Verify navigation is visible (indicates app is functional)
  await expect(
    page.getByRole("link", { name: "Home", exact: true })
  ).toBeVisible({ timeout: 15000 });
});
