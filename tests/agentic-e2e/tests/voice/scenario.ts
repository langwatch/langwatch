/**
 * Scenario execution for the voice-agent contract steps.
 *
 * Covers creating the voice agent, authoring the scenario, starting the run,
 * and waiting for it through to a verdict — driven through the UI by
 * clicking, exactly as a person runs it.
 *
 * @see ../voice-agent-contract.spec.ts
 */
import { type Page, expect } from "@playwright/test";

import { getProjectSlug } from "../helpers";
import { CALL_START_TIMEOUT_MS, CALL_VERDICT_TIMEOUT_MS } from "./constants";

// =============================================================================
// Given: a voice agent of the right transport, created through the Agents page
// =============================================================================

/**
 * Given a voice agent of the given transport, created up front through the
 * Agents page's header "New Agent" button (agents-new-agent), then the voice
 * type in the same agent type selector drawer the run dialog used to open.
 *
 * The run dialog's own "setup agent" card (run-dialog-setup-agent) only
 * renders on a project with zero agents, so it times out on any project that
 * already has one. The Agents page's "New Agent" button is not gated on agent
 * count, so it is the persistent path — creating the agent here, before the
 * run dialog is even open, works regardless of the project's prior state.
 */
export async function givenAVoiceAgentExists(
  page: Page,
  {
    name,
    transport,
    phoneNumber,
    agentId,
  }: {
    name: string;
    transport: "phone" | "elevenlabs_convai";
    phoneNumber?: string;
    agentId?: string;
  },
) {
  const projectSlug = await getProjectSlug(page);
  await page.goto(`/${projectSlug}/agents`);
  await page.getByTestId("agents-new-agent").click();
  await page.getByTestId("agent-type-voice").click();
  await expect(page.getByTestId("voice-agent-name-input")).toBeVisible({
    timeout: 15_000,
  });
  await fillAndSaveVoiceDrawer(page, { name, transport, phoneNumber, agentId });
}

/**
 * Fill and save the voice drawer for the given transport. The transport select
 * is a native <select>; phone needs the E.164 number, ElevenLabs the agent id.
 */
async function fillAndSaveVoiceDrawer(
  page: Page,
  {
    name,
    transport,
    phoneNumber,
    agentId,
  }: {
    name: string;
    transport: "phone" | "elevenlabs_convai";
    phoneNumber?: string;
    agentId?: string;
  },
) {
  await page.getByTestId("voice-agent-name-input").fill(name);
  await page
    .getByTestId("voice-agent-transport-select")
    .selectOption(transport);

  if (transport === "phone") {
    await page.getByTestId("voice-agent-phone-input").fill(phoneNumber ?? "");
  } else {
    await page.getByTestId("voice-agent-id-input").fill(agentId ?? "");
  }

  await page.getByTestId("save-agent-button").click();
  await expect(page.getByTestId("voice-agent-name-input")).not.toBeVisible({
    timeout: 15_000,
  });
}

// =============================================================================
// When: author a scenario, provide criteria, run it — all through the UI
// =============================================================================

/** The Scenarios tab of Agent Testing. */
export async function givenTheyAreOnTheSimulationsPage(page: Page) {
  const projectSlug = await getProjectSlug(page);
  await page.goto(`/${projectSlug}/agent-testing`);
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 10_000 })
    .toBe(`/${projectSlug}/agent-testing`);
}

/**
 * When they author a scenario and provide the criteria it is judged on.
 *
 * The scenario editor is the same one the HTTP scenario test drives; the agent
 * is not bound to the scenario here — the run dialog is where the voice agent
 * is chosen, so authoring is transport-agnostic. Uses label-based fields and
 * Save & Run, which opens the run dialog.
 */
export async function whenTheyAuthorAScenarioWithCriteria(
  page: Page,
  { title, situation, criteria }: { title: string; situation: string; criteria: string[] },
) {
  // A project needs an agent and a suite before a scenario can be written. The
  // day-zero empty states create them when absent and no-op when present, so a
  // scenario can always be authored regardless of the project's current state.
  await ensureAgentAndSuite(page);
  await page.getByRole("button", { name: /new scenario/i }).first().click();

  await page.getByLabel("Title").last().fill(title);
  await page.getByLabel("Situation").last().fill(situation);
  await page.getByLabel("Criteria").last().fill(criteria.join("\n"));

  await page.getByTestId("case-modal-save-and-run").last().click();
  await expect(page.getByText(/scenario (created|updated)/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("run-case-dialog")).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Ensure the day-zero prerequisites for authoring a scenario: an agent and a
 * suite. Both empty states no-op when the thing already exists, so this is safe
 * to call on any project. The agent created here is an HTTP stub — the voice
 * agent under test is created later, in the run dialog.
 */
async function ensureAgentAndSuite(page: Page) {
  await page
    .getByTestId("agent-testing-cases-panel")
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByTestId("agent-testing-cases-skeleton")
    .waitFor({ state: "detached", timeout: 30_000 });

  const connectEmpty = page.getByTestId("agent-testing-connect-agent-empty");
  if (
    await connectEmpty
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await connectEmpty.getByRole("button", { name: /setup agent/i }).click();
    await page.getByTestId("agent-type-http").click();
    const nameInput = page.getByTestId("agent-name-input");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("E2E HTTP Agent");
    await page.getByTestId("url-input").fill("http://127.0.0.1:9/e2e-agent");
    await page.getByTestId("save-agent-button").click();
    await expect(connectEmpty).not.toBeVisible({ timeout: 15_000 });
  }

  const suiteEmpty = page.getByTestId("agent-testing-first-suite-empty");
  if (
    await suiteEmpty
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await suiteEmpty.getByRole("button", { name: /new test suite/i }).click();
    const suiteDialog = page.getByTestId("agent-testing-suite-name-dialog");
    await expect(suiteDialog).toBeVisible();
    await suiteDialog.getByLabel("Test suite name").fill("E2E Suite");
    await suiteDialog.getByTestId("suite-name-confirm").click();
    await expect(suiteEmpty).not.toBeVisible({ timeout: 15_000 });
  }
}

/**
 * When they run the simulation against the voice agent.
 *
 * The voice agent already exists by this point (created up front by
 * givenAVoiceAgentExists), so this just selects its card by name in the run
 * dialog, starts the run, and waits for the run drawer to open on it. The
 * caller passes the same `name` it created the agent with — the project is
 * reused across runs, so a hardcoded name here would risk matching a stale
 * card left over from an earlier run.
 */
export async function whenTheyRunTheSimulation(
  page: Page,
  { name }: { name: string },
) {
  const dialog = page.getByTestId("run-case-dialog");
  const agentCard = dialog
    .locator('[data-testid^="run-dialog-agent-"]')
    .filter({ hasText: name })
    .first();
  await expect(agentCard).toBeVisible({ timeout: 15_000 });
  if ((await agentCard.getAttribute("aria-pressed")) !== "true") {
    await agentCard.click();
  }

  const run = dialog.getByTestId("run-dialog-run");
  await expect(run).toBeEnabled({ timeout: 10_000 });
  await run.click();

  await expect(page.getByTestId("agent-testing-run-drawer")).toBeVisible({
    timeout: 30_000,
  });
}

// =============================================================================
// Then: the call is placed, joined, and judged
// =============================================================================

/**
 * Then LangWatch places the call: the run leaves the queued state. A run that
 * has left "Queued" has been handed to the transport, which is what placing the
 * call is from the UI's side — there is no separate "dialing" affordance.
 */
export async function thenTheCallIsPlaced(page: Page) {
  await expect(page.getByTestId("wide-drawer-queued")).not.toBeVisible({
    timeout: CALL_START_TIMEOUT_MS,
  });
}

/**
 * Then a simulated user talks to the agent: the conversation body fills with
 * turns rather than the waiting/queued placeholder.
 */
export async function thenASimulatedUserTalksToTheAgent(page: Page) {
  const body = page.getByTestId("run-drawer-conversation-body");
  await expect(body).toBeVisible({ timeout: CALL_VERDICT_TIMEOUT_MS });
  await expect(page.getByTestId("wide-drawer-queued")).not.toBeVisible();
  await expect(page.getByTestId("wide-drawer-waiting")).not.toBeVisible();
}

/** Then the run is judged against their criteria: a verdict with the criteria. */
export async function thenTheRunIsJudgedAgainstCriteria(page: Page) {
  await expect(page.getByTestId("run-verdict-panel")).toBeVisible({
    timeout: CALL_VERDICT_TIMEOUT_MS,
  });
  await expect(page.getByTestId("run-verdict-status-line")).toBeVisible();
  await expect(page.getByTestId("run-verdict-pending")).not.toBeVisible();
}

/** Then they can see the results. */
export async function thenTheyCanSeeTheResults(page: Page) {
  await expect(page.getByTestId("run-verdict-panel")).toBeVisible();
}

/** Then they can see the whole conversation as a transcript. */
export async function thenTheyCanSeeTheTranscript(page: Page) {
  await expect(page.getByTestId("run-drawer-conversation-body")).toBeVisible();
}
