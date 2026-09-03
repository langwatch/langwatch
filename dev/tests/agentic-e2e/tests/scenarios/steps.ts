/**
 * Step definitions for the Agent Testing feature tests.
 *
 * These functions are named to match the Gherkin language of the feature files:
 * - specs/features/agent-testing/page-structure.feature
 * - specs/features/agent-testing/cases-table.feature
 * - specs/features/agent-testing/run-dialog.feature
 *
 * Usage: import and compose these steps in test files to create readable
 * tests that map directly to the feature specifications.
 *
 * A fresh project starts at day zero: no agent, no test suite, no scenario.
 * The steps that need one of them create it when it is missing, so the same
 * test runs against an empty CI project and against a project that already
 * holds data.
 */
import { Page, expect } from "@playwright/test";

import { getProjectSlug } from "../helpers";

const E2E_AGENT_NAME = "E2E HTTP Agent";
const E2E_SUITE_NAME = "E2E Suite";

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
 * Given I am on the scenarios page
 * The Scenarios tab of Agent Testing.
 */
export async function givenIAmOnTheScenariosPage(page: Page) {
  const projectSlug = await getProjectSlug(page);
  await page.goto(`/${projectSlug}/agent-testing`);
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
    .toBe(`/${projectSlug}/agent-testing`);
}

/**
 * Given I am on the results page
 * The Results tab of Agent Testing.
 */
export async function givenIAmOnTheResultsPage(page: Page) {
  const projectSlug = await getProjectSlug(page);
  await page.goto(`/${projectSlug}/agent-testing/results`);
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10000 })
    .toBe(`/${projectSlug}/agent-testing/results`);
}

/**
 * When I open a saved simulations address
 * The address an older SDK or a bookmark still names.
 */
export async function whenIOpenTheSimulationsScenariosAddress(page: Page) {
  const projectSlug = await getProjectSlug(page);
  await page.goto(`/${projectSlug}/simulations/scenarios`);
}

/**
 * Then I see the Agent Testing page
 */
export async function thenISeeTheAgentTestingPage(page: Page) {
  await expect(page).toHaveURL(/\/agent-testing/);
  await expect(page.getByTestId("agent-testing-title")).toHaveText(/agent testing/i);
  await expect(page.getByRole("tab", { name: /scenarios/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /results/i })).toBeVisible();
}

/**
 * Then I see the results tab
 */
export async function thenISeeTheResultsTab(page: Page) {
  await expect(page.getByTestId("agent-testing-results-tab")).toBeVisible({
    timeout: 15000,
  });
  const noRuns = page.getByText("No runs yet");
  const plans = page.getByTestId("agent-testing-run-plans");
  await noRuns.or(plans).first().waitFor({ state: "visible", timeout: 15000 });
}

// =============================================================================
// Day zero: agent and test suite
// =============================================================================

/**
 * Given the project has an agent
 * A project with no agent reads "Setup agent" first. This creates an HTTP
 * agent through the same drawer a person uses. The address does not have to
 * answer: a run against it fails, and that is a result too.
 */
export async function givenTheProjectHasAnAgent(page: Page) {
  const connectEmpty = page.getByTestId("agent-testing-connect-agent-empty");
  const needsAgent = await connectEmpty
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!needsAgent) return;

  await connectEmpty.getByRole("button", { name: /setup agent/i }).click();
  await page.getByTestId("agent-type-http").click();

  const nameInput = page.getByTestId("agent-name-input");
  await expect(nameInput).toBeVisible({ timeout: 10000 });
  await nameInput.fill(E2E_AGENT_NAME);
  await page.getByTestId("url-input").fill("http://127.0.0.1:9/e2e-agent");
  await page.getByTestId("save-agent-button").click();

  await expect(nameInput).not.toBeVisible({ timeout: 15000 });
  await expect(connectEmpty).not.toBeVisible({ timeout: 15000 });
}

/**
 * Given the project has a test suite
 * Every scenario sits in a suite, so a project with none names one first.
 */
export async function givenTheProjectHasATestSuite(page: Page) {
  const suiteEmpty = page.getByTestId("agent-testing-first-suite-empty");
  const needsSuite = await suiteEmpty
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!needsSuite) return;

  await suiteEmpty.getByRole("button", { name: /new test suite/i }).click();
  const dialog = page.getByTestId("agent-testing-suite-name-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Test suite name").fill(E2E_SUITE_NAME);
  await dialog.getByTestId("suite-name-confirm").click();

  await expect(dialog).not.toBeVisible({ timeout: 10000 });
  await expect(suiteEmpty).not.toBeVisible({ timeout: 15000 });
}

/**
 * Given I can write a scenario
 * The agent and the suite a scenario needs, in the order the page asks.
 */
export async function givenICanWriteAScenario(page: Page) {
  await givenTheProjectHasAnAgent(page);
  await givenTheProjectHasATestSuite(page);
}

// =============================================================================
// Scenario Editor - Create Steps
// =============================================================================

/**
 * Then I see a "New scenario" button
 */
export async function thenISeeNewScenarioButton(page: Page) {
  await expect(page.getByRole("button", { name: /new scenario/i }).first()).toBeVisible();
}

/**
 * When I click "New scenario"
 * The button sits in the panel header over a suite, or in the empty state of
 * a project that holds no scenario yet.
 */
export async function whenIClickNewScenario(page: Page) {
  await givenICanWriteAScenario(page);
  await page
    .getByRole("button", { name: /new scenario/i })
    .first()
    .click();
}

/** The Title field of the scenario editor drawer. */
function titleField(page: Page) {
  return page.getByLabel("Title").last();
}

/**
 * Then I see the scenario editor
 * Then I see an empty scenario form
 */
export async function thenISeeTheScenarioEditor(page: Page) {
  await expect(page.getByRole("heading", { name: /^new scenario$/i }).last()).toBeVisible();
  await expect(titleField(page)).toHaveValue("");
}

/**
 * Then I see the scenario form fields (Title, Situation, Criteria)
 */
export async function thenISeeScenarioFormFields(page: Page) {
  await expect(titleField(page)).toBeVisible();
  await expect(page.getByLabel("Situation").last()).toBeVisible();
  await expect(page.getByLabel("Criteria").last()).toBeVisible();
}

/**
 * When I fill in "Title" with "<title>"
 */
export async function whenIFillInTitleWith(page: Page, title: string) {
  await titleField(page).fill(title);
}

/**
 * When I fill in "Situation" with "<situation>"
 */
export async function whenIFillInSituationWith(page: Page, situation: string) {
  await page.getByLabel("Situation").last().fill(situation);
}

/**
 * When I write the criteria, one per line
 */
export async function whenIWriteCriteria(page: Page, criteria: string[]) {
  await page.getByLabel("Criteria").last().fill(criteria.join("\n"));
}

/**
 * Then the criteria field holds every line
 */
export async function thenCriteriaFieldHolds(page: Page, criteria: string[]) {
  await expect(page.getByLabel("Criteria").last()).toHaveValue(criteria.join("\n"));
}

/**
 * When I click "Save"
 * The drawer closes itself after the success toast.
 */
export async function whenIClickSave(page: Page) {
  await page.getByTestId("case-modal-save").last().click();

  await expect(page.getByText(/scenario (created|updated)/i)).toBeVisible({
    timeout: 10000,
  });
  await expect(titleField(page)).not.toBeVisible({ timeout: 10000 });
}

/**
 * When I click "Save & Run"
 * Saves the scenario and opens the run dialog for it.
 */
export async function whenIClickSaveAndRun(page: Page) {
  await page.getByTestId("case-modal-save-and-run").last().click();

  await expect(page.getByText(/scenario (created|updated)/i)).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("run-case-dialog")).toBeVisible({
    timeout: 15000,
  });
}

// =============================================================================
// Scenario Editor - Edit Steps
// =============================================================================

/**
 * When I click on "<title>" in the list
 * A row click opens the scenario in the editor.
 */
export async function whenIClickOnScenarioInList(page: Page, title: string) {
  await page.getByTestId(`case-row-${title}`).first().click();
  await expect(page.getByRole("heading", { name: /^edit scenario$/i }).last()).toBeVisible();
}

/**
 * Then the form is populated with the existing data
 */
export async function thenFormIsPopulatedWithTitle(page: Page, title: string) {
  await expect(titleField(page)).toHaveValue(title);
}

/**
 * When I change the title to "<title>"
 */
export async function whenIChangeTitleTo(page: Page, title: string) {
  const field = titleField(page);
  await field.clear();
  await field.fill(title);
}

// =============================================================================
// Scenarios table
// =============================================================================

/**
 * Then "<title>" appears in the list
 */
export async function thenScenarioAppearsInList(page: Page, title: string) {
  await expect(page.getByTestId(`case-row-${title}`).first()).toBeVisible({
    timeout: 10000,
  });
}

/**
 * Then I see the scenarios panel
 * One of: the day zero empty states, an empty suite, or the table of scenarios.
 */
export async function thenISeeTheScenariosPanel(page: Page) {
  const states = [
    "agent-testing-connect-agent-empty",
    "agent-testing-first-suite-empty",
    "agent-testing-first-case-empty",
    "agent-testing-empty-suite",
  ].map((testId) => page.getByTestId(testId));
  const anyState = states.reduce((all, one) => all.or(one));
  const rows = page.locator('[data-testid^="case-row-"]');
  await anyState.or(rows).first().waitFor({ state: "visible", timeout: 15000 });
}

// =============================================================================
// Run dialog and run drawer
// =============================================================================

/**
 * When I pick the first agent and start the run
 */
export async function whenIStartTheRun(page: Page) {
  const dialog = page.getByTestId("run-case-dialog");
  const agentCard = dialog.locator('[data-testid^="run-dialog-agent-"]').first();
  await expect(agentCard).toBeVisible({ timeout: 10000 });
  if ((await agentCard.getAttribute("aria-pressed")) !== "true") {
    await agentCard.click();
  }
  const run = dialog.getByTestId("run-dialog-run");
  await expect(run).toBeEnabled({ timeout: 10000 });
  await run.click();
}

/**
 * Then the run is queued, or the dialog reads that no model provider is set up
 * The platform refuses a run in a project without a model provider, and the
 * dialog reads the notice in place of a queued run; that is what CI is. With a
 * provider the run drawer opens on the run: queued, waiting for a verdict,
 * judged, or failed to start, every one of them is the run being shown.
 */
export async function thenTheRunIsQueuedOrNeedsAProvider(page: Page) {
  const drawer = page.getByTestId("agent-testing-run-drawer");
  const notice = page.getByTestId("run-dialog-missing-provider");
  await drawer.or(notice).first().waitFor({ state: "visible", timeout: 30000 });

  if (await notice.isVisible()) {
    await expect(notice).toContainText("No model provider is set up");
    return;
  }

  const states = [
    "wide-drawer-queued",
    "run-verdict-pending",
    "run-verdict-panel",
    "run-verdict-error",
  ].map((testId) => page.getByTestId(testId));
  await states
    .reduce((all, one) => all.or(one))
    .first()
    .waitFor({ state: "visible", timeout: 60000 });
}
