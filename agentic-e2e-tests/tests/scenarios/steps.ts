/**
 * Step definitions for Scenario feature tests
 *
 * These functions are named to match Gherkin language from feature files:
 * - specs/scenarios/scenario-editor.feature
 * - specs/scenarios/scenario-library.feature
 * - specs/scenarios/scenario-execution.feature
 *
 * Usage: Import and compose these steps in test files to create
 * readable tests that map directly to feature specifications.
 */
import { Page, expect } from "@playwright/test";

// =============================================================================
// Background Steps
// =============================================================================

/**
 * Background: Given I am logged into project "my-project"
 */
export async function givenIAmLoggedIntoProject(page: Page) {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/auth\//);
}

// =============================================================================
// Navigation Steps
// =============================================================================

/**
 * Given I am on the scenarios list page
 * When I am on the scenarios list page
 */
export async function givenIAmOnTheScenariosListPage(page: Page) {
  await page.goto("/");

  // Wait for the sidebar Home link to appear (indicates app is loaded)
  const homeLink = page.getByRole("link", { name: "Home", exact: true });
  await expect(homeLink).toBeVisible({ timeout: 30000 });

  const href = await homeLink.getAttribute("href");
  const projectSlug = href?.replace(/^\//, "") || "";

  if (!projectSlug) {
    throw new Error("Could not extract project slug from Home link");
  }

  await page.goto(`/${projectSlug}/simulations/scenarios`);
  await expect(page).toHaveURL(/simulations\/scenarios/);
}

/**
 * Given I am on the simulations page (Runs)
 */
export async function givenIAmOnTheSimulationsPage(page: Page) {
  await page.goto("/");

  // Wait for dashboard to load
  await expect(
    page.getByRole("heading", { name: /hello/i })
  ).toBeVisible({ timeout: 15000 });

  // Expand simulations submenu
  const simulationsButton = page.getByRole("button", { name: /expand simulations/i });
  await expect(simulationsButton).toBeVisible({ timeout: 5000 });
  await simulationsButton.click();

  // Click "Runs" link
  const runsLink = page.getByRole("link", { name: "Runs", exact: true });
  await expect(runsLink).toBeVisible({ timeout: 5000 });
  await runsLink.click();

  await expect(page).toHaveURL(/simulations/, { timeout: 10000 });
}

/**
 * Then I see the scenarios list page
 */
export async function thenISeeTheScenariosListPage(page: Page) {
  await expect(page).toHaveURL(/simulations\/scenarios/);
  await expect(
    page.getByRole("heading", { name: /scenario library/i })
  ).toBeVisible();
}

/**
 * Then I see a "New Scenario" button
 */
export async function thenISeeNewScenarioButton(page: Page) {
  await expect(
    page.getByRole("button", { name: /new scenario/i })
  ).toBeVisible();
}

// =============================================================================
// Scenario Editor - Create Steps
// =============================================================================

/**
 * When I click "New Scenario"
 */
export async function whenIClickNewScenario(page: Page) {
  await page.getByRole("button", { name: /new scenario/i }).click();
}

/**
 * Then I navigate to the scenario editor
 * Then I see an empty scenario form
 */
export async function thenISeeTheScenarioEditor(page: Page) {
  // Chakra renders duplicate dialogs - use .last() for the visible one
  await expect(
    page.getByRole("heading", { name: /create scenario/i }).last()
  ).toBeVisible();
}

/**
 * Then I see the scenario form fields (Name, Situation, Criteria, Labels)
 */
export async function thenISeeScenarioFormFields(page: Page) {
  // Name field
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }).first()
  ).toBeVisible();

  // Situation field (using placeholder as fallback - no label available)
  await expect(
    page.getByPlaceholder(/a frustrated premium subscriber/i).first()
  ).toBeVisible();

  // Criteria field (using placeholder as fallback - no label available)
  await expect(
    page.getByPlaceholder(/must apologize for the inconvenience/i).first()
  ).toBeVisible();
}

/**
 * When I fill in "Name" with "<name>"
 */
export async function whenIFillInNameWith(page: Page, name: string) {
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .last()
    .fill(name);
}

/**
 * When I fill in "Situation" with "<situation>"
 */
export async function whenIFillInSituationWith(page: Page, situation: string) {
  await page
    .getByPlaceholder(/a frustrated premium subscriber/i)
    .last()
    .fill(situation);
}

/**
 * When I add criterion "<criterion>"
 */
export async function whenIAddCriterion(page: Page, criterion: string) {
  await page
    .getByPlaceholder(/must apologize for the inconvenience/i)
    .last()
    .fill(criterion);
  await page.getByRole("button", { name: "Add" }).last().click();
}

/**
 * Then the criterion appears in the criteria list
 */
export async function thenCriterionAppearsInList(page: Page, criterion: string) {
  // Criteria appear as textbox inputs with the criterion as their value
  const criterionInput = page
    .getByRole("textbox")
    .filter({ hasText: criterion })
    .last();
  await expect(criterionInput).toBeVisible({ timeout: 5000 });
}

/**
 * When I click "Save"
 * Handles the "Save and Run" popover by clicking "Save without running"
 */
export async function whenIClickSave(page: Page) {
  const saveButton = page
    .getByRole("button", { name: /save and run/i })
    .last();
  await saveButton.click();

  // Popover opens - click "Save without running"
  const saveWithoutRunning = page.getByText("Save without running").last();
  await expect(saveWithoutRunning).toBeVisible({ timeout: 5000 });
  await saveWithoutRunning.click();

  // Wait for save to complete by checking dialog closes or list updates
  await expect(saveButton).not.toBeVisible({ timeout: 10000 });
}

/**
 * When I close the scenario editor
 */
export async function whenICloseTheEditor(page: Page) {
  const closeButton = page.getByRole("button", { name: "Close" }).last();
  await closeButton.click();

  // Wait for dialog to close
  await expect(
    page.getByRole("heading", { name: /create scenario|edit scenario/i }).last()
  ).not.toBeVisible({ timeout: 5000 });
}

// =============================================================================
// Scenario Editor - Edit Steps
// =============================================================================

/**
 * When I click on "<name>" in the list
 */
export async function whenIClickOnScenarioInList(page: Page, name: string) {
  await page.getByText(name).click();
}

/**
 * Then the form is populated with the existing data
 */
export async function thenFormIsPopulatedWithName(page: Page, name: string) {
  const nameField = page
    .getByRole("textbox", { name: "Name", exact: true })
    .last();
  await expect(nameField).toHaveValue(name);
}

/**
 * When I change the name to "<name>"
 */
export async function whenIChangeNameTo(page: Page, name: string) {
  const nameField = page
    .getByRole("textbox", { name: "Name", exact: true })
    .last();
  await nameField.clear();
  await nameField.fill(name);
}

// =============================================================================
// Scenario Library - List Steps
// =============================================================================

/**
 * Then "<name>" appears in the list
 */
export async function thenScenarioAppearsInList(page: Page, name: string) {
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Then I see the empty state
 */
export async function thenISeeEmptyState(page: Page) {
  await expect(page.getByText("No scenarios yet")).toBeVisible({ timeout: 10000 });
}

/**
 * Then I see the scenarios table
 */
export async function thenISeeScenarioTable(page: Page) {
  await expect(page.getByRole("table")).toBeVisible({ timeout: 10000 });
}

// =============================================================================
// Scenario Execution Steps
// =============================================================================

/**
 * Then I see the simulations page content
 */
export async function thenISeeSimulationsPageContent(page: Page) {
  // Either empty state or simulation results
  const emptyStateHeading = page.getByRole("heading", { name: /scenario.*agentic.*simulations/i });
  const simulationSetsHeading = page.getByRole("heading", { name: /simulation sets/i });

  await expect(emptyStateHeading.or(simulationSetsHeading)).toBeVisible({ timeout: 15000 });
}

/**
 * When I click "Run" on a scenario
 */
export async function whenIClickRunOnScenario(page: Page) {
  await page.getByRole("button", { name: /^run$/i }).last().click();
}

/**
 * Then the run starts
 */
export async function thenTheRunStarts(page: Page) {
  // Look for running indicator or navigation to run page
  const runningIndicator = page.getByText(/running|in progress/i);
  const runPage = page.locator("[data-testid='run-visualization']");

  await expect(runningIndicator.or(runPage).first()).toBeVisible({ timeout: 30000 });
}

/**
 * Then I see the conversation
 */
export async function thenISeeTheConversation(page: Page) {
  // Conversation messages appear in the run visualization
  const messageContainer = page.getByRole("log").or(page.locator("[data-testid='conversation']"));
  await expect(messageContainer).toBeVisible({ timeout: 30000 });
}

/**
 * Then I see pass/fail status
 */
export async function thenISeePassFailStatus(page: Page) {
  const passStatus = page.getByText(/pass|passed/i);
  const failStatus = page.getByText(/fail|failed/i);

  await expect(passStatus.or(failStatus).first()).toBeVisible({ timeout: 30000 });
}
