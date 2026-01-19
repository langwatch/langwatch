import { test, expect } from "@playwright/test";

/**
 * Feature: Scenario Library
 * Source: specs/scenarios/scenario-library.feature
 *
 * As a LangWatch user
 * I want to browse and manage my scenarios
 * So that I can organize my behavioral test cases
 *
 * These tests specify the V1 Scenario Library UI.
 * Tests marked with test.fixme() will fail until the feature is implemented.
 */

test.describe("Scenario Library", () => {
  // Background: logged into project
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for auth - should redirect to project page
    await expect(page).not.toHaveURL(/\/auth\//);
  });

  // ===========================================================================
  // Navigation
  // ===========================================================================

  // FIXME: V1 Scenario Library UI not implemented - "New Scenario" button doesn't exist yet
  test.fixme("navigate to scenarios list", async ({ page }) => {
    // When I navigate to the simulations page
    await page.goto("/");
    const simulationsLink = page.getByRole("link", {
      name: "Simulations",
      exact: true,
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

  // ===========================================================================
  // List View
  // ===========================================================================

  // FIXME: V1 Scenario Library UI not implemented - scenario list table doesn't exist yet
  test.fixme("view scenarios in list", async ({ page }) => {
    // Given scenarios exist in the project (seeded via API)
    // TODO: Seed scenarios via API before test

    // When I am on the scenarios list page
    await page.goto("/");
    await page.getByRole("link", { name: "Simulations", exact: true }).click();
    await expect(page).toHaveURL(/simulations/);

    // Then I see a list with scenarios
    const scenarioList = page.getByRole("table");
    await expect(scenarioList).toBeVisible();

    // And each row shows the scenario name
    const scenarioRows = page.getByRole("row");
    await expect(scenarioRows.first()).toBeVisible();

    // And each row shows the labels
    const labelBadges = page.locator('[data-testid="scenario-labels"]');
    await expect(labelBadges.first()).toBeVisible();
  });

  // FIXME: V1 Scenario Library UI not implemented - needs seeding + clickable scenario rows
  test.fixme("click scenario row to edit", async ({ page }) => {
    // Given scenario "Refund Flow" exists (seeded via API)
    // TODO: Seed scenario via API before test

    // When I am on the scenarios list page
    await page.goto("/");
    await page.getByRole("link", { name: "Simulations", exact: true }).click();

    // When I click on a scenario in the list
    const scenarioRow = page.getByRole("row", { name: /refund flow/i });
    await scenarioRow.click();

    // Then I navigate to the scenario editor
    await expect(page).toHaveURL(/simulations\/[^/]+\/edit|scenarios\/[^/]+/);
  });

  // FIXME: V1 Scenario Library UI not implemented - "New Scenario" CTA doesn't exist yet
  // Current page shows generic "Get Started" page, not scenario-specific empty state
  test.fixme("empty state when no scenarios", async ({ page }) => {
    // Given no scenarios exist in the project
    // (Fresh project or cleaned up state)

    // When I am on the scenarios list page
    await page.goto("/");
    await page.getByRole("link", { name: "Simulations", exact: true }).click();

    // Then I see an empty state message
    const emptyState = page.getByText(/no scenarios/i);
    await expect(emptyState).toBeVisible();

    // And I see a call to action to create a scenario
    const createCta = page.getByRole("button", { name: /new scenario/i });
    await expect(createCta).toBeVisible();
  });

  // ===========================================================================
  // Filtering
  // ===========================================================================

  // FIXME: V1 Scenario Library UI not implemented - label filter doesn't exist yet
  test.fixme("filter scenarios by label", async ({ page }) => {
    // Given scenarios exist with various labels (seeded via API)
    // TODO: Seed scenarios with labels via API before test

    // When I am on the scenarios list page
    await page.goto("/");
    await page.getByRole("link", { name: "Simulations", exact: true }).click();

    // When I select label "support" in the filter
    const labelFilter = page.getByRole("combobox", { name: /label|filter/i });
    await labelFilter.click();
    await page.getByRole("option", { name: /support/i }).click();

    // Then I only see scenarios with the "support" label
    const visibleRows = page.getByRole("row").filter({ hasText: /support/i });
    await expect(visibleRows.first()).toBeVisible();

    // Verify filtered scenarios all have the label
    const allRows = await page.getByRole("row").all();
    for (const row of allRows.slice(1)) {
      // Skip header row
      const labels = row.locator('[data-testid="scenario-labels"]');
      await expect(labels).toContainText(/support/i);
    }
  });
});
