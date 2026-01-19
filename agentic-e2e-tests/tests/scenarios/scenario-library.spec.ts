import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  thenISeeTheScenariosListPage,
  thenISeeNewScenarioButton,
  thenISeeEmptyStateOrScenarioList,
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
  // Background: Given I am logged into project
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  // ===========================================================================
  // Navigation
  // ===========================================================================

  /**
   * Scenario: Navigate to scenarios list
   * Source: scenario-library.feature lines 13-17
   */
  test("navigate to scenarios list", async ({ page }) => {
    // When I navigate to the scenarios list page
    await givenIAmOnTheScenariosListPage(page);

    // Then I see the scenarios list page
    await thenISeeTheScenariosListPage(page);

    // And I see a "New Scenario" button
    await thenISeeNewScenarioButton(page);
  });

  // ===========================================================================
  // List View
  // ===========================================================================

  /**
   * Scenario: Empty state when no scenarios
   * Source: scenario-library.feature lines 41-45
   *
   * Note: "View scenarios in list" and "Click scenario row to edit" are
   * covered by the workflow test in scenario-editor.spec.ts
   */
  test("empty state or list when on scenarios page", async ({ page }) => {
    // Given I am on the scenarios list page
    await givenIAmOnTheScenariosListPage(page);

    // Then I see the Scenario Library heading
    await thenISeeTheScenariosListPage(page);

    // And I see the "New Scenario" button
    await thenISeeNewScenarioButton(page);

    // Then I see an empty state message OR a list of scenarios
    await thenISeeEmptyStateOrScenarioList(page);
  });
});
