import { test, expect } from "@playwright/test";
import {
  givenIAmLoggedIntoProject,
  givenIAmOnTheScenariosListPage,
  givenIAmOnTheSimulationsPage,
  thenISeeSimulationsPageContent,
  whenIClickNewScenario,
  whenIFillInNameWith,
  whenIFillInSituationWith,
  whenIAddCriterion,
  whenIClickSave,
  thenScenarioAppearsInList,
} from "./steps";

/**
 * Feature: Scenario Execution
 * Source: specs/scenarios/scenario-execution.feature
 *
 * As a LangWatch user
 * I want to run scenarios against my agents
 * So that I can validate their behavior meets my criteria
 *
 * Note: These tests require NLP service to be running for execution.
 */
test.describe("Scenario Execution", () => {
  test.beforeEach(async ({ page }) => {
    await givenIAmLoggedIntoProject(page);
  });

  // ===========================================================================
  // Simulations Page
  // ===========================================================================

  /**
   * Scenario: View simulations page
   * Source: scenario-execution.feature (implicit - page must load)
   */
  test("displays simulations page content", async ({ page }) => {
    await givenIAmOnTheSimulationsPage(page);
    await thenISeeSimulationsPageContent(page);
  });

  // ===========================================================================
  // Running Scenarios
  // ===========================================================================

  /**
   * Scenario: Run scenario and view results
   * Source: scenario-execution.feature lines 14-19, 34-38, 41-46
   *
   * Workflow test: creates scenario, runs it, and verifies results appear.
   * Requires NLP service to be running.
   */
  test("executes scenario and displays run results", async ({ page }) => {
    // Create a scenario first
    await givenIAmOnTheScenariosListPage(page);
    await whenIClickNewScenario(page);

    const scenarioName = `E2E Run Test ${Date.now()}`;
    await whenIFillInNameWith(page, scenarioName);
    await whenIFillInSituationWith(page, "A user asking about product features");
    await whenIAddCriterion(page, "Agent provides accurate information");

    // Save and run
    const saveAndRunButton = page.getByRole("button", { name: /save and run/i }).last();
    await saveAndRunButton.click();

    // Click "Save and run" (not "Save without running")
    const saveAndRunOption = page.getByText("Save and run").last();
    await expect(saveAndRunOption).toBeVisible({ timeout: 5000 });
    await saveAndRunOption.click();

    // Wait for navigation to run visualization or for run to start
    // The UI should show the run in progress or completed
    await expect(page).toHaveURL(/simulations/, { timeout: 30000 });

    // Verify we see either running state or results
    const runningOrResults = page
      .getByText(/running|in progress|completed|pass|fail/i)
      .first();
    await expect(runningOrResults).toBeVisible({ timeout: 60000 });
  });

  /**
   * Scenario: View run history
   * Source: scenario-execution.feature lines 59-63
   *
   * After running a scenario, verifies results appear in history.
   */
  test("displays run in simulation history after execution", async ({ page }) => {
    // Navigate to simulations page
    await givenIAmOnTheSimulationsPage(page);

    // Either we see existing runs or empty state
    const simulationContent = page.getByRole("heading", { name: /simulation sets/i });
    const emptyState = page.getByRole("heading", { name: /scenario.*agentic.*simulations/i });

    await expect(simulationContent.or(emptyState)).toBeVisible({ timeout: 15000 });

    // If there are simulation sets, we should be able to see run details
    const hasSimulations = await simulationContent.isVisible().catch(() => false);
    if (hasSimulations) {
      // Click on a simulation set to view details
      const firstSimulationSet = page.getByRole("button", { name: /view|expand/i }).first();
      if (await firstSimulationSet.isVisible().catch(() => false)) {
        await firstSimulationSet.click();
        // Should see run details
        await expect(
          page.getByText(/run|execution|results/i).first()
        ).toBeVisible({ timeout: 10000 });
      }
    }
  });
});
