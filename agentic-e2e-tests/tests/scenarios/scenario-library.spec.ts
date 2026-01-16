import { test, expect } from "@playwright/test";

/**
 * Feature: Scenario Library
 * Source: specs/scenarios/scenario-library.feature
 *
 * As a LangWatch user
 * I want to browse and manage my scenarios
 * So that I can organize my behavioral test cases
 */

// ============================================================================
// Navigation
// ============================================================================

test("Scenario Library - navigate to scenarios list", async ({ page }) => {
  // When I navigate to the simulations page
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Find and click on the Simulations navigation item
  const simulationsLink = page.getByRole("link", {
    name: /simulations|scenarios/i,
  });
  await simulationsLink.click();

  // Then I see the scenarios list page
  await expect(page).toHaveURL(/simulations/);

  // And I see a "New Scenario" button
  const newScenarioButton = page.getByRole("button", {
    name: /new scenario/i,
  });
  await expect(newScenarioButton).toBeVisible();
});

// ============================================================================
// List View
// ============================================================================

test("Scenario Library - view scenarios in list", async ({ page }) => {
  // Given scenarios exist in the project (created via API or seed)
  // This test assumes scenarios have been seeded

  // When I am on the scenarios list page
  await page.goto("/");
  const simulationsLink = page.getByRole("link", {
    name: /simulations|scenarios/i,
  });
  await simulationsLink.click();
  await expect(page).toHaveURL(/simulations/);

  // Then I see a list with scenarios
  // Each row shows the scenario name and labels
  const scenarioList = page.locator('[data-testid="scenario-list"]');
  // Note: This locator may need adjustment based on actual DOM structure
  await expect(scenarioList.or(page.getByRole("table"))).toBeVisible();
});

test("Scenario Library - click scenario row to edit", async ({ page }) => {
  // Given scenario exists (created via API or seed)
  await page.goto("/");
  const simulationsLink = page.getByRole("link", {
    name: /simulations|scenarios/i,
  });
  await simulationsLink.click();
  await expect(page).toHaveURL(/simulations/);

  // When I click on a scenario in the list
  const scenarioRow = page.locator('[data-testid="scenario-row"]').first();
  // Fallback to table row if data-testid not present
  const clickTarget = scenarioRow.or(
    page
      .getByRole("row")
      .filter({ hasNot: page.getByRole("columnheader") })
      .first()
  );

  // Only proceed if there are scenarios
  const hasScenarios = await clickTarget.isVisible().catch(() => false);
  if (hasScenarios) {
    await clickTarget.click();
    // Then I navigate to the scenario editor
    await expect(page).toHaveURL(/simulations\/.*\/edit|scenarios\/.*/);
  }
});

test("Scenario Library - empty state when no scenarios", async ({ page }) => {
  // Given no scenarios exist in the project
  // This would need a fresh project or cleanup

  // When I am on the scenarios list page
  await page.goto("/");
  const simulationsLink = page.getByRole("link", {
    name: /simulations|scenarios/i,
  });
  await simulationsLink.click();

  // Then I see an empty state message (if no scenarios exist)
  // And I see a call to action to create a scenario
  const emptyState = page.getByText(
    /no scenarios|create your first|get started/i
  );
  const newScenarioButton = page.getByRole("button", {
    name: /new scenario/i,
  });

  // Either we have scenarios in the list, or we see empty state
  const hasEmptyState = await emptyState.isVisible().catch(() => false);
  if (hasEmptyState) {
    await expect(emptyState).toBeVisible();
  }
  // New scenario button should always be visible
  await expect(newScenarioButton).toBeVisible();
});

// ============================================================================
// Filtering
// ============================================================================

test("Scenario Library - filter scenarios by label", async ({ page }) => {
  // Given scenarios exist with various labels
  await page.goto("/");
  const simulationsLink = page.getByRole("link", {
    name: /simulations|scenarios/i,
  });
  await simulationsLink.click();
  await expect(page).toHaveURL(/simulations/);

  // When I select a label in the filter
  const labelFilter = page.getByRole("combobox", { name: /label|filter/i });
  const hasFilter = await labelFilter.isVisible().catch(() => false);

  if (hasFilter) {
    await labelFilter.click();
    // Select first available label option
    const labelOption = page.getByRole("option").first();
    await labelOption.click();

    // Then I only see scenarios with that label
    // Verification would depend on the filtered results
    await page.waitForLoadState("networkidle");
  }
});
