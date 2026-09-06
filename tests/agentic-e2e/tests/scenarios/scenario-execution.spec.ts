import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheResultsPage,
  givenIAmOnTheScenariosPage,
  thenISeeTheAgentTestingPage,
  thenISeeTheResultsTab,
  thenTheRunIsQueuedOrNeedsAProvider,
  whenIClickNewScenario,
  whenIClickSaveAndRun,
  whenIFillInSituationWith,
  whenIFillInTitleWith,
  whenIStartTheRun,
  whenIWriteCriteria,
} from "./steps";

/**
 * Feature: Scenario execution
 * Source: specs/features/agent-testing/run-dialog.feature
 *
 * As a LangWatch user
 * I want to run scenarios against my agents
 * So that I can validate their behavior meets my criteria
 */
test.describe("Scenario Execution", () => {
  // Describe-level slow() applies to every test in the suite. The execution
  // test waits on a queued run; the others are cheap but the longer budget
  // is harmless.
  test.slow();
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  // ===========================================================================
  // Results tab
  // ===========================================================================

  /**
   * Scenario: The Results tab lists the run plans
   * Source: page-structure.feature
   */
  test("displays the results tab", async ({ page }) => {
    await givenIAmOnTheResultsPage(page);

    await thenISeeTheAgentTestingPage(page);
    await thenISeeTheResultsTab(page);
  });

  // ===========================================================================
  // Running Scenarios
  // ===========================================================================

  /**
   * Scenario: Save & Run opens the run dialog for the scenario
   * Source: run-dialog.feature
   *
   * Workflow test: creates a scenario, saves it and starts the run. The
   * platform refuses the run in a project without a model provider and the
   * dialog reads the notice, which is what CI is. With a provider the run is
   * queued and the run drawer opens on it.
   */
  test("saves and runs a scenario from the editor", async ({ page }) => {
    await givenIAmOnTheScenariosPage(page);
    await whenIClickNewScenario(page);

    await whenIFillInTitleWith(page, `E2E Run Test ${Date.now()}`);
    await whenIFillInSituationWith(page, "A user asking about product features");
    await whenIWriteCriteria(page, ["Agent provides accurate information"]);

    await whenIClickSaveAndRun(page);
    await whenIStartTheRun(page);

    await thenTheRunIsQueuedOrNeedsAProvider(page);
  });
});
