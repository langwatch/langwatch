import { test } from '@playwright/test';

/**
 * Default seed for Playwright MCP test planning.
 * This file is used by planner_setup_page when no seed is specified.
 */
test('seed', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});
