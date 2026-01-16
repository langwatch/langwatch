import { test, expect } from "@playwright/test";

/**
 * Feature: Scenario Execution / Simulation Results
 * Source: specs/scenarios/scenario-execution.feature
 *
 * Note: The LangWatch Scenario feature uses a code-based SDK approach.
 * Scenarios are executed via the Scenario SDK, and results appear in this UI.
 * These tests verify the simulation results page displays correctly.
 */

// Helper to navigate to simulations page via sidebar
async function navigateToSimulations(page: import("@playwright/test").Page) {
  await page.goto("/");

  const simulationsLink = page.getByRole("link", {
    name: "Simulations",
    exact: true,
  });
  await expect(simulationsLink).toBeVisible({ timeout: 15000 });
  await simulationsLink.click();

  await expect(page).toHaveURL(/simulations/, { timeout: 10000 });
}

// ============================================================================
// Viewing Simulation Results
// ============================================================================

test("Scenario Execution - view simulations page loads", async ({ page }) => {
  // When I navigate to the simulations page
  await navigateToSimulations(page);

  // Then the page loads without errors
  await expect(page).toHaveURL(/simulations/);

  // And we see some content
  const hasContent = await page.getByRole("heading").first().isVisible().catch(() => false);
  expect(hasContent).toBeTruthy();
});

test("Scenario Execution - simulations page shows content", async ({ page }) => {
  // Given I am on the simulations page
  await navigateToSimulations(page);
  await page.waitForTimeout(1000);

  // Then I see either simulation results OR the getting started state
  const hasResults = await page.getByRole("table").isVisible().catch(() => false);
  const hasList = await page.getByRole("list").first().isVisible().catch(() => false);
  const hasHeading = await page.getByRole("heading").first().isVisible().catch(() => false);

  expect(hasResults || hasList || hasHeading).toBeTruthy();
});

test("Scenario Execution - page displays correctly on reload", async ({
  page,
}) => {
  // Given I am on the simulations page
  await navigateToSimulations(page);

  // When I reload the page
  await page.reload();
  await page.waitForTimeout(2000);

  // Then the page still displays correctly
  await expect(page).toHaveURL(/simulations/);

  // And content is visible
  const hasContent = await page.getByRole("heading").first().isVisible().catch(() => false);
  expect(hasContent).toBeTruthy();
});
