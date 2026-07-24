import { test, expect } from "@playwright/test";

/**
 * Default seed for test planning.
 * This navigates to the app home after authentication.
 */
test("seed", async ({ page }) => {
  await page.goto("/");
  // Wait for the main app to load by checking for navigation
  await expect(page.locator("main, [role='main'], #__next")).toBeVisible({ timeout: 15000 });
});
