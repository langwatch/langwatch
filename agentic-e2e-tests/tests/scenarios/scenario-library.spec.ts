import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  thenISeeTheScenariosListPage,
  thenISeeNewScenarioButton,
  thenISeeEmptyState,
  thenISeeScenarioTable,
} from "./steps";

/**
 * Feature: Scenario Library
 * Source: specs/scenarios/scenario-library.feature
 *
 * As a LangWatch user
 * I want to browse and manage my scenarios
 * So that I can organize my behavioral test cases
 *
 * Note: Tests requiring seeded data (view scenarios in list, click to edit,
 * filter by label) are covered by the workflow test in scenario-editor.spec.ts
 */
test.describe("Scenario Library", () => {
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  /**
   * Scenario: View scenarios list page
   * Source: scenario-library.feature lines 13-17, 41-45
   *
   * Verifies the scenarios page displays correctly with either
   * empty state or existing scenarios table.
   */
  test("displays scenario library with new scenario button", async ({ page }) => {
    await givenIAmOnTheScenariosListPage(page);

    await thenISeeTheScenariosListPage(page);
    await thenISeeNewScenarioButton(page);

    // Verify either empty state or table is shown
    const emptyState = page.getByText("No scenarios yet");
    const table = page.getByRole("table");

    // One of these should be visible
    await emptyState.or(table).first().waitFor({ state: "visible", timeout: 10000 });
  });
});
