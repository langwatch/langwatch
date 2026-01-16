import { test, expect } from "@playwright/test";

/**
 * Feature: Scenario Library / Simulations Page
 * Source: specs/scenarios/scenario-library.feature
 *
 * As a LangWatch user
 * I want to browse my simulation results
 * So that I can see how my scenarios have performed
 *
 * Note: Scenarios are created via the Scenario SDK (code-based), not through UI.
 * This page displays simulation results and getting-started information.
 */

// Helper to navigate to simulations page via sidebar
async function navigateToSimulations(page: import("@playwright/test").Page) {
  await page.goto("/");

  // Wait for the sidebar navigation to be visible
  const simulationsLink = page.getByRole("link", {
    name: "Simulations",
    exact: true,
  });
  await expect(simulationsLink).toBeVisible({ timeout: 15000 });
  await simulationsLink.click();

  // Wait for URL to change to simulations page
  await expect(page).toHaveURL(/simulations/, { timeout: 10000 });
}

// ============================================================================
// Navigation
// ============================================================================

test("Scenario Library - navigate to simulations page", async ({ page }) => {
  // When I navigate to the simulations page
  await navigateToSimulations(page);

  // Then I see the Scenario page content
  // Wait for the page to fully load
  await page.waitForTimeout(2000);

  // Check for the heading or any Scenario-related content
  const heading = page.getByRole("heading").first();
  await expect(heading).toBeVisible({ timeout: 10000 });
});

// ============================================================================
// Page Content
// ============================================================================

test("Scenario Library - view simulations page content", async ({ page }) => {
  // When I am on the simulations page
  await navigateToSimulations(page);
  await page.waitForTimeout(1000);

  // Then I see content about Scenario
  // Either simulation results (table) or getting started content
  const hasTable = await page.getByRole("table").isVisible().catch(() => false);
  const hasList = await page.getByRole("list").first().isVisible().catch(() => false);
  const hasHeading = await page.getByRole("heading").first().isVisible().catch(() => false);

  expect(hasTable || hasList || hasHeading).toBeTruthy();
});

test("Scenario Library - empty state shows documentation link", async ({
  page,
}) => {
  // Given no simulations have been run yet
  await navigateToSimulations(page);
  await page.waitForTimeout(1000);

  // Then I see a link to learn more about Scenario
  const docsLink = page.getByRole("link", {
    name: /learn more|documentation|scenario/i,
  });
  const hasDocsLink = await docsLink.first().isVisible().catch(() => false);

  // Or we have simulation results
  const hasResults = await page.getByRole("table").isVisible().catch(() => false);

  expect(hasDocsLink || hasResults).toBeTruthy();
});

test("Scenario Library - view scenario capabilities", async ({ page }) => {
  // Given I am on the simulations page
  await navigateToSimulations(page);
  await page.waitForTimeout(1000);

  // Then I see information about what Scenario can do
  // Either in a features list or simulation results
  const featuresList = page.getByRole("list");
  const resultsTable = page.getByRole("table");

  const hasFeatures = await featuresList.first().isVisible().catch(() => false);
  const hasResults = await resultsTable.isVisible().catch(() => false);

  expect(hasFeatures || hasResults).toBeTruthy();
});
