import { test, expect } from "@playwright/test";

/**
 * Smoke Tests
 *
 * Basic tests to verify the application is running and accessible.
 * These tests run after authentication setup.
 */

test("Smoke - application is accessible and user is authenticated", async ({
  page,
}) => {
  // Navigate to the app - should be redirected to projects or onboarding
  await page.goto("/");

  // Wait for the page to load
  await page.waitForLoadState("networkidle");

  // Verify we're not on the login page (auth setup should have authenticated us)
  await expect(page).not.toHaveURL(/\/auth\/signin/);

  // Verify some core UI element is visible (adjust based on actual app structure)
  // This could be the sidebar, header, or main content area
  const mainContent = page.locator("main, [role='main'], #__next");
  await expect(mainContent).toBeVisible();
});

test("Smoke - API health endpoint responds", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
});
