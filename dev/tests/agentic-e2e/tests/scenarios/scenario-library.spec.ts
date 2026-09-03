import { test } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosPage,
  givenICanWriteAScenario,
  thenISeeNewScenarioButton,
  thenISeeTheAgentTestingPage,
  thenISeeTheScenariosPanel,
  whenIOpenTheSimulationsScenariosAddress,
} from "./steps";

/**
 * Feature: Agent Testing page structure
 * Source: specs/features/agent-testing/page-structure.feature
 *
 * As a LangWatch user
 * I want to browse and manage my scenarios
 * So that I can organize my behavioral test cases
 */
test.describe("Scenario Library", () => {
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  /**
   * Scenario: The page opens on the Scenarios tab
   * Source: page-structure.feature
   *
   * The page reads its title and both tabs, and the scenarios panel shows
   * one of its states: a day zero empty state, an empty suite, or the table.
   */
  test("displays the scenarios tab with its panel", async ({ page }) => {
    await givenIAmOnTheScenariosPage(page);

    await thenISeeTheAgentTestingPage(page);
    await thenISeeTheScenariosPanel(page);
  });

  /**
   * Scenario: A project with a suite offers New scenario
   * Source: cases-table.feature
   */
  test("offers a New scenario button once a suite exists", async ({ page }) => {
    await givenIAmOnTheScenariosPage(page);
    await givenICanWriteAScenario(page);

    await thenISeeNewScenarioButton(page);
  });

  /**
   * Scenario: A saved simulations address opens in Agent Testing when the flag is on
   * Source: page-structure.feature
   *
   * The flag is on by default, so the address an older SDK or a bookmark
   * still names lands on the Agent Testing page.
   */
  test("redirects a saved simulations address to Agent Testing", async ({ page }) => {
    await whenIOpenTheSimulationsScenariosAddress(page);

    await thenISeeTheAgentTestingPage(page);
  });
});
