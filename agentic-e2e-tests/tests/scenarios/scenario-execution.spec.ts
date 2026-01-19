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

  // Wait for the dashboard to load
  await expect(page.getByRole("heading", { name: /hello/i })).toBeVisible({ timeout: 15000 });

  // Click the "Expand Simulations" button in the sidebar to open submenu
  const simulationsButton = page.getByRole("button", { name: /expand simulations/i });
  await expect(simulationsButton).toBeVisible({ timeout: 5000 });
  await simulationsButton.click();

  // Click "Runs" link to go to /simulations (main simulations page)
  const runsLink = page.getByRole("link", { name: "Runs", exact: true });
  await expect(runsLink).toBeVisible({ timeout: 5000 });
  await runsLink.click();

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

  // And we see the page content - either the empty state info card or simulation results
  // The empty state shows "Scenario: Agentic Simulations" heading
  // Wait for either the info card heading or simulation set cards to appear
  const infoCardHeading = page.getByRole("heading", { name: /scenario.*agentic.*simulations/i });
  const simulationSetsHeading = page.getByRole("heading", { name: /simulation sets/i });

  await expect(infoCardHeading.or(simulationSetsHeading)).toBeVisible({ timeout: 15000 });
});

test("Scenario Execution - simulations page shows content", async ({ page }) => {
  // Given I am on the simulations page
  await navigateToSimulations(page);

  // Then I see either simulation results OR the getting started info card
  // The info card has specific text about what Scenario can do
  const infoCardText = page.getByText("Your simulations will appear here");
  const simulationSetsHeading = page.getByRole("heading", { name: /simulation sets/i });

  await expect(infoCardText.or(simulationSetsHeading)).toBeVisible({ timeout: 15000 });
});

test("Scenario Execution - page displays correctly on reload", async ({
  page,
}) => {
  // Given I am on the simulations page
  await navigateToSimulations(page);

  // Wait for initial content to load
  const infoCardHeading = page.getByRole("heading", { name: /scenario.*agentic.*simulations/i });
  const simulationSetsHeading = page.getByRole("heading", { name: /simulation sets/i });
  await expect(infoCardHeading.or(simulationSetsHeading)).toBeVisible({ timeout: 15000 });

  // When I reload the page
  await page.reload();

  // Then the page still displays correctly
  await expect(page).toHaveURL(/simulations/);

  // And the same content is visible again after reload
  await expect(infoCardHeading.or(simulationSetsHeading)).toBeVisible({ timeout: 15000 });
});
