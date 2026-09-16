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
 */
test.describe("Scenario Library", () => {
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  /**
   * Scenario: The page opens on the Scenarios tab (page-structure.feature).
   * Panel shows one of its states: day-zero empty, empty suite, or table.
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
   * Scenario: A saved simulations address opens in Agent Testing when the
   * flag is on (page-structure.feature, default-on).
   */
  test("redirects a saved simulations address to Agent Testing", async ({ page }) => {
    await whenIOpenTheSimulationsScenariosAddress(page);

    await thenISeeTheAgentTestingPage(page);
  });
});
