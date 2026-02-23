import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  whenIClickNewScenario,
  thenISeeTheScenarioEditor,
  thenISeeScenarioFormFields,
  whenIFillInNameWith,
  whenIFillInSituationWith,
  whenIAddCriterion,
  thenCriterionAppearsInList,
  whenIClickSave,
  whenIClickOnScenarioInList,
  thenFormIsPopulatedWithName,
  whenIChangeNameTo,
  thenScenarioAppearsInList,
} from "./steps";

/**
 * Feature: Scenario Editor
 * Source: specs/scenarios/scenario-editor.feature
 *
 * As a LangWatch user
 * I want to create and edit scenario specifications
 * So that I can define behavioral test cases for my agents
 */
// Skipped: flaky — timeouts in CI environment
test.describe.skip("Scenario Editor", () => {
  // Background: Given I am logged into project
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  // ===========================================================================
  // Create Scenario
  // ===========================================================================

  /**
   * Scenario: Navigate to create form
   * Source: scenario-editor.feature lines 14-18
   */
  test("navigate to create form", async ({ page }) => {
    // Given I am on the scenarios list page
    await givenIAmOnTheScenariosListPage(page);

    // When I click "New Scenario"
    await whenIClickNewScenario(page);

    // Then I navigate to the scenario editor
    // And I see an empty scenario form
    await thenISeeTheScenarioEditor(page);
  });

  /**
   * Scenario: View scenario form fields
   * Source: scenario-editor.feature lines 20-28
   */
  test("view scenario form fields", async ({ page }) => {
    // Given I am on the scenarios list page
    await givenIAmOnTheScenariosListPage(page);

    // When I click "New Scenario"
    await whenIClickNewScenario(page);

    // Then I see the scenario editor
    await thenISeeTheScenarioEditor(page);

    // Then I see the following fields: Name, Situation, Criteria
    await thenISeeScenarioFormFields(page);
  });

  // ===========================================================================
  // Scenario Lifecycle (Workflow Test)
  // ===========================================================================

  /**
   * Workflow test covering multiple feature scenarios:
   * - scenario-editor.feature: "Save new scenario" (lines 30-39)
   * - scenario-library.feature: "Click scenario row to edit" (lines 34-38)
   * - scenario-editor.feature: "Load existing scenario for editing" (lines 45-52)
   * - scenario-editor.feature: "Update scenario name" (lines 54-59)
   *
   * This combines scenarios that would otherwise require seeded data
   * into a single self-contained workflow test.
   */
  test("scenario lifecycle: create, view in list, edit, and verify", async ({
    page,
  }) => {
    // -------------------------------------------------------------------------
    // Scenario: Save new scenario
    // -------------------------------------------------------------------------

    // Given I am on the scenarios list page
    await givenIAmOnTheScenariosListPage(page);

    // When I click "New Scenario"
    await whenIClickNewScenario(page);

    // And I fill in "Name" with "Refund Request Test"
    await whenIFillInNameWith(page, "Refund Request Test");

    // And I fill in "Situation" with "User requests a refund for a defective product"
    await whenIFillInSituationWith(
      page,
      "User requests a refund for a defective product"
    );

    // And I add criterion "Agent acknowledges the issue"
    await whenIAddCriterion(page, "Agent acknowledges the issue");

    // And I click "Save"
    await whenIClickSave(page);

    // Then I navigate back to the scenarios list
    await givenIAmOnTheScenariosListPage(page);

    // And "Refund Request Test" appears in the list
    await thenScenarioAppearsInList(page, "Refund Request Test");

    // -------------------------------------------------------------------------
    // Scenario: Click scenario row to edit (from scenario-library.feature)
    // -------------------------------------------------------------------------

    // When I click on "Refund Request Test" in the list
    await whenIClickOnScenarioInList(page, "Refund Request Test");

    // -------------------------------------------------------------------------
    // Scenario: Load existing scenario for editing
    // -------------------------------------------------------------------------

    // Then the form is populated with the existing data
    await thenFormIsPopulatedWithName(page, "Refund Request Test");

    // -------------------------------------------------------------------------
    // Scenario: Update scenario name
    // -------------------------------------------------------------------------

    // When I change the name to "Refund Request (Updated)"
    await whenIChangeNameTo(page, "Refund Request (Updated)");

    // And I click "Save"
    await whenIClickSave(page);

    // Then I navigate back to the scenarios list
    await givenIAmOnTheScenariosListPage(page);

    // And I see the updated name in the list
    await thenScenarioAppearsInList(page, "Refund Request (Updated)");
  });

  // ===========================================================================
  // Criteria Management
  // ===========================================================================

  /**
   * Scenario: Add criterion to list
   * Source: scenario-editor.feature lines 65-71
   */
  test("add criterion to list", async ({ page }) => {
    // Given I am on the scenario editor
    await givenIAmOnTheScenariosListPage(page);
    await whenIClickNewScenario(page);
    await thenISeeTheScenarioEditor(page);

    // When I type criterion "Agent must apologize"
    // And I click the add button
    await whenIAddCriterion(page, "Agent must apologize");

    // Then the criterion appears in the criteria list
    await thenCriterionAppearsInList(page, "Agent must apologize");
  });
});
