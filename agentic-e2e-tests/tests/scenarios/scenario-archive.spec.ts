import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  whenIClickNewScenario,
  whenIFillInNameWith,
  whenIFillInSituationWith,
  whenIClickSave,
  thenScenarioAppearsInList,
  whenIOpenRowActionMenuFor,
  whenIClickArchiveInMenu,
  thenISeeArchiveConfirmationModal,
  whenIConfirmArchival,
  thenScenarioDoesNotAppearInList,
  whenISelectCheckboxFor,
  thenISeeTheBatchActionBar,
  whenIClickArchiveInBatchBar,
  thenISeeArchiveConfirmationModalListing,
} from "./steps";

/**
 * Feature: Scenario Archiving
 * Source: specs/scenarios/scenario-deletion.feature
 *
 * As a LangWatch user
 * I want to archive scenarios from the library
 * So that I can remove test cases I no longer need while preserving history
 *
 * Note: These are workflow tests that create their own scenarios via the UI
 * since there is no API seeding available.
 */
test.describe("Scenario Archive", () => {
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  /**
   * Scenario: Archive a single scenario via row action menu
   * Source: scenario-deletion.feature lines 20-28
   *
   * This workflow test creates 5 scenarios, then archives one via
   * the row action menu and verifies the remaining scenarios are intact.
   */
  test("archive a single scenario via row action menu", async ({ page }) => {
    // Setup: Create 5 scenarios
    await givenIAmOnTheScenariosListPage(page);

    const scenarios = [
      "Angry double-charge refund",
      "Cross-doc synthesis question",
      "Failed booking escalation",
      "SaaS documentation guidance",
      "HTTP troubleshooting request",
    ];

    for (const name of scenarios) {
      await whenIClickNewScenario(page);
      await whenIFillInNameWith(page, name);
      await whenIFillInSituationWith(page, "Test situation for archive e2e");
      await whenIClickSave(page);

      await givenIAmOnTheScenariosListPage(page);
      await thenScenarioAppearsInList(page, name);
    }

    // Archive "Angry double-charge refund"
    await whenIOpenRowActionMenuFor(page, "Angry double-charge refund");
    await whenIClickArchiveInMenu(page);
    await thenISeeArchiveConfirmationModal(page, "Angry double-charge refund");
    await whenIConfirmArchival(page);

    // Verification: Archived scenario is gone, others remain
    await thenScenarioDoesNotAppearInList(page, "Angry double-charge refund");
    await thenScenarioAppearsInList(page, "Cross-doc synthesis question");
    await thenScenarioAppearsInList(page, "Failed booking escalation");
    await thenScenarioAppearsInList(page, "SaaS documentation guidance");
    await thenScenarioAppearsInList(page, "HTTP troubleshooting request");
  });

  /**
   * Scenario: Batch archive multiple selected scenarios
   * Source: scenario-deletion.feature lines 30-40
   *
   * This workflow test creates 5 scenarios, then archives 2 of them
   * via batch selection and verifies the remaining scenarios are intact.
   */
  test("batch archive multiple selected scenarios", async ({ page }) => {
    // Setup: Create 5 scenarios with unique prefix
    await givenIAmOnTheScenariosListPage(page);

    const scenarios = [
      "Batch-Cross-doc synthesis question",
      "Batch-Failed booking escalation",
      "Batch-SaaS documentation guidance",
      "Batch-HTTP troubleshooting request",
      "Batch-Angry double-charge refund",
    ];

    for (const name of scenarios) {
      await whenIClickNewScenario(page);
      await whenIFillInNameWith(page, name);
      await whenIFillInSituationWith(page, "Test situation for batch archive e2e");
      await whenIClickSave(page);

      await givenIAmOnTheScenariosListPage(page);
      await thenScenarioAppearsInList(page, name);
    }

    // Selection: Select 2 scenarios
    await whenISelectCheckboxFor(page, "Batch-Cross-doc synthesis question");
    await whenISelectCheckboxFor(page, "Batch-Failed booking escalation");
    await thenISeeTheBatchActionBar(page, 2);

    // Archive: Batch archive
    await whenIClickArchiveInBatchBar(page);
    await thenISeeArchiveConfirmationModalListing(page, [
      "Batch-Cross-doc synthesis question",
      "Batch-Failed booking escalation",
    ]);
    await whenIConfirmArchival(page);

    // Verification: Archived scenarios are gone, others remain
    await thenScenarioDoesNotAppearInList(page, "Batch-Cross-doc synthesis question");
    await thenScenarioDoesNotAppearInList(page, "Batch-Failed booking escalation");
    await thenScenarioAppearsInList(page, "Batch-SaaS documentation guidance");
    await thenScenarioAppearsInList(page, "Batch-HTTP troubleshooting request");
    await thenScenarioAppearsInList(page, "Batch-Angry double-charge refund");
  });
});
