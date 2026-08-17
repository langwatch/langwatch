import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  thenMaximumTurnsShows,
  whenIArchiveScenarioFromListIfPresent,
  whenIClickNewScenario,
  whenIClickOnScenarioInList,
  whenIClickSave,
  whenICloseTheEditor,
  whenIFillInMaximumTurnsWith,
  whenIFillInNameWith,
  whenIFillInSituationWith,
} from "./steps";

/**
 * Feature: Per-scenario maximum conversation turns
 * Source: specs/scenarios/scenario-max-turns.feature
 *
 * As a user running agent scenario simulations
 * I want to cap how many conversation turns a scenario can take
 * So that a simulation stops at a bound I chose
 */
test.describe("Scenario turn cap", () => {
  test.slow();
  // Background: Given I am logged into project
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  /**
   * Workflow test: create with a cap, reopen, clear the cap, reopen.
   * A unique name keeps reruns from colliding, and the finally block
   * archives whatever the test managed to create even when an assertion
   * in the middle failed.
   */
  /** @scenario "A turn cap set in the scenario editor survives saving and reopening" */
  test("turn cap survives saving and reopening", async ({ page }) => {
    const scenarioName = `Turn Cap Test ${Date.now()}`;

    await givenIAmOnTheScenariosListPage(page);

    try {
      // -----------------------------------------------------------------------
      // Create a scenario with Maximum turns 2 and save
      // -----------------------------------------------------------------------
      await whenIClickNewScenario(page);
      await whenIFillInNameWith(page, scenarioName);
      await whenIFillInSituationWith(
        page,
        "A user asks the agent a simple question"
      );
      await whenIFillInMaximumTurnsWith(page, "2");
      await whenIClickSave(page);

      // -----------------------------------------------------------------------
      // Reopen: the cap survived the save
      // -----------------------------------------------------------------------
      await givenIAmOnTheScenariosListPage(page);
      await whenIClickOnScenarioInList(page, scenarioName);
      await thenMaximumTurnsShows(page, "2");

      // -----------------------------------------------------------------------
      // Clear the cap and save
      // -----------------------------------------------------------------------
      await whenIFillInMaximumTurnsWith(page, "");
      await whenIClickSave(page);

      // -----------------------------------------------------------------------
      // Reopen: the field is empty, so the default applies
      // -----------------------------------------------------------------------
      await givenIAmOnTheScenariosListPage(page);
      await whenIClickOnScenarioInList(page, scenarioName);
      await thenMaximumTurnsShows(page, "");
      await whenICloseTheEditor(page);
    } finally {
      // Archive the scenario this test created, even when an assertion
      // above failed. The navigation resets whatever drawer or dialog the
      // failure left open; with nothing created there is nothing to clean.
      await givenIAmOnTheScenariosListPage(page);
      await whenIArchiveScenarioFromListIfPresent(page, scenarioName);
    }
  });
});
