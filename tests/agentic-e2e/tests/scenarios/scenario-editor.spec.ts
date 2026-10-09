import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosPage,
  whenIClickNewScenario,
  thenISeeTheScenarioEditor,
  thenISeeScenarioFormFields,
  whenIFillInTitleWith,
  whenIFillInSituationWith,
  whenIWriteCriteria,
  thenCriteriaFieldHolds,
  whenIClickSave,
  whenIClickOnScenarioInList,
  thenFormIsPopulatedWithTitle,
  whenIChangeTitleTo,
  thenScenarioAppearsInList,
} from "./steps";

/**
 * Feature: Scenario editor
 * Source: specs/features/agent-testing/cases-table.feature
 *
 * As a LangWatch user
 * I want to create and edit scenarios
 * So that I can define behavioral test cases for my agents
 */
test.describe("Scenario Editor", () => {
  test.slow();
  // Background: Given I am logged into project
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  // ===========================================================================
  // Create Scenario
  // ===========================================================================

  /**
   * Scenario: Navigate to create form
   */
  test("navigate to create form", async ({ page }) => {
    // Given I am on the scenarios page
    await givenIAmOnTheScenariosPage(page);

    // When I click "New scenario"
    await whenIClickNewScenario(page);

    // Then I see an empty scenario form
    await thenISeeTheScenarioEditor(page);
  });

  /**
   * Scenario: View scenario form fields
   */
  test("view scenario form fields", async ({ page }) => {
    // Given I am on the scenarios page
    await givenIAmOnTheScenariosPage(page);

    // When I click "New scenario"
    await whenIClickNewScenario(page);

    // Then I see the scenario editor
    await thenISeeTheScenarioEditor(page);

    // Then I see the following fields: Title, Situation, Criteria
    await thenISeeScenarioFormFields(page);
  });

  // ===========================================================================
  // Scenario Lifecycle (Workflow Test)
  // ===========================================================================

  /**
   * Workflow test covering several feature scenarios:
   * - Save a new scenario
   * - The scenario appears in the table
   * - A row click opens the scenario in the editor
   * - The editor holds the saved data
   * - Update the title
   *
   * This combines scenarios that would otherwise require seeded data
   * into a single self-contained workflow test.
   */
  test("scenario lifecycle: create, view in list, edit, and verify", async ({
    page,
  }) => {
    const title = `Refund Request Test ${Date.now()}`;
    const updatedTitle = `${title} (Updated)`;

    // -------------------------------------------------------------------------
    // Scenario: Save new scenario
    // -------------------------------------------------------------------------

    // Given I am on the scenarios page
    await givenIAmOnTheScenariosPage(page);

    // When I click "New scenario"
    await whenIClickNewScenario(page);

    // And I fill in "Title"
    await whenIFillInTitleWith(page, title);

    // And I fill in "Situation" with "User requests a refund for a defective product"
    await whenIFillInSituationWith(
      page,
      "User requests a refund for a defective product",
    );

    // And I write the criterion "Agent acknowledges the issue"
    await whenIWriteCriteria(page, ["Agent acknowledges the issue"]);

    // And I click "Save"
    await whenIClickSave(page);

    // Then the scenario appears in the list
    await thenScenarioAppearsInList(page, title);

    // -------------------------------------------------------------------------
    // Scenario: Click scenario row to edit
    // -------------------------------------------------------------------------

    // When I click on the scenario in the list
    await whenIClickOnScenarioInList(page, title);

    // -------------------------------------------------------------------------
    // Scenario: Load existing scenario for editing
    // -------------------------------------------------------------------------

    // Then the form is populated with the existing data
    await thenFormIsPopulatedWithTitle(page, title);

    // -------------------------------------------------------------------------
    // Scenario: Update scenario title
    // -------------------------------------------------------------------------

    // When I change the title
    await whenIChangeTitleTo(page, updatedTitle);

    // And I click "Save"
    await whenIClickSave(page);

    // Then I see the updated title in the list
    await thenScenarioAppearsInList(page, updatedTitle);
  });

  // ===========================================================================
  // Criteria
  // ===========================================================================

  /**
   * Scenario: Criteria are written one per line
   */
  test("writes criteria one per line", async ({ page }) => {
    // Given I am on the scenario editor
    await givenIAmOnTheScenariosPage(page);
    await whenIClickNewScenario(page);
    await thenISeeTheScenarioEditor(page);

    // When I write two criteria
    const criteria = ["Agent must apologize", "Agent offers a refund"];
    await whenIWriteCriteria(page, criteria);

    // Then the criteria field holds both lines
    await thenCriteriaFieldHolds(page, criteria);
  });
});
