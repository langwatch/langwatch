import { test } from "@playwright/test";

/**
 * Default seed for test planning.
 * This navigates to the app home after authentication.
 */
test("seed", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
});
