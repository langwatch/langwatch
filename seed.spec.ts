import { test, expect } from '@playwright/test';

/**
 * Default seed for Playwright MCP test planning.
 * This file is used by planner_setup_page when no seed is specified.
 */
test('seed', async ({ page }) => {
  await page.goto('/');
  // Wait for auth to complete - should not be on auth page
  await expect(page).not.toHaveURL(/\/auth\//);
  // Wait for navigation to appear
  await expect(page.getByRole("link", { name: "Simulations", exact: true })).toBeVisible({ timeout: 15000 });
});
