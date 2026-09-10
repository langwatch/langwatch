/**
 * Step definitions for the voice-agent simulation contract tests.
 *
 * Named to match the Gherkin of the two contract feature files:
 *  - specs/simulation-testing/voice-agents/testing-phone-agents.feature
 *  - specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature
 *
 * The whole journey is driven through the UI by clicking, exactly as a person
 * runs it: the agent is created up front through the Agents page's voice
 * drawer, the scenario is authored in the scenario editor, and the run is
 * started from the run dialog. Nothing
 * here calls an API to TRIGGER a run — the one API use is precondition setup
 * (the provider credential row), which mirrors auth.setup.ts creating the org
 * and project over tRPC rather than clicking through onboarding.
 *
 * @see specs/simulation-testing/voice-agents/testing-phone-agents.feature
 * @see specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature
 */
import { type Locator, type Page, expect } from "@playwright/test";

import { getProjectSlug } from "../helpers";

/**
 * A real voice call takes time to place, hold, and hang up before the judge
 * can read it. Two minutes is the ceiling a call is expected to need, so the
 * verdict wait is given a generous margin above it rather than the suite's
 * default 10s expect timeout — a run that is still on the phone is working,
 * not hung.
 */
export const CALL_VERDICT_TIMEOUT_MS = 180_000;

/** How long to wait for the call to start (leave the queued state). */
const CALL_START_TIMEOUT_MS = 60_000;

// =============================================================================
// Credentials — the tests gate on these, they never hardcode a secret
// =============================================================================

export type PhoneCreds = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
};

export type ElevenLabsCreds = {
  apiKey: string;
  agentId: string;
};

/** The Twilio + callee credentials a phone call needs, or null if any is unset. */
export function phoneCredsFromEnv(): PhoneCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const toNumber = process.env.E2E_VOICE_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber || !toNumber) return null;
  return { accountSid, authToken, fromNumber, toNumber };
}

/** The ElevenLabs credentials a ConvAI call needs, or null if any is unset. */
export function elevenLabsCredsFromEnv(): ElevenLabsCreds | null {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.E2E_ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) return null;
  return { apiKey, agentId };
}

// =============================================================================
// Background
// =============================================================================

/** Background: Given a LangWatch user with a project. */
export async function givenAUserWithAProject(page: Page) {
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/auth\//);
}

/**
 * Precondition (not a run trigger): the project carries the provider row whose
 * key signs the call, filled from the environment credentials. Uses the same
 * authenticated `page.request` path auth.setup uses to provision the org, so
 * the drawer's "no key in this project" branch is not what the test exercises.
 */
async function ensureProviderKey(
  page: Page,
  { provider, customKeys }: { provider: string; customKeys: Record<string, string> },
) {
  const projectSlug = await getProjectSlug(page);
  // getProjectSlug reads organization.getAll; we still need the project id for
  // the tenant anchor, which the same payload carries.
  const response = await page.request.get(
    "/api/trpc/organization.getAll?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: {} } })),
  );
  const data = (await response.json().catch(() => null)) as unknown;
  const projectId = findProjectIdForSlug(data, projectSlug);
  if (!projectId) {
    throw new Error(
      `Could not resolve a project id for slug "${projectSlug}" to set the ${provider} key`,
    );
  }
  await page.request.post("/api/trpc/modelProvider.update?batch=1", {
    data: {
      "0": {
        json: { projectId, provider, enabled: true, customKeys },
      },
    },
  });
}

type OrgGetAll = {
  "0"?: {
    result?: {
      data?: {
        json?: Array<{
          teams?: Array<{ projects?: Array<{ id?: string; slug?: string }> }>;
        }>;
      };
    };
  };
};

function findProjectIdForSlug(data: unknown, slug: string): string | null {
  const orgs = (data as OrgGetAll)?.["0"]?.result?.data?.json ?? [];
  for (const org of orgs) {
    for (const team of org.teams ?? []) {
      for (const project of team.projects ?? []) {
        if (project.slug === slug && project.id) return project.id;
        // A pinned E2E_PROJECT_SLUG may not match; fall back to first id.
        if (!slug && project.id) return project.id;
      }
    }
  }
  // When the slug is pinned via env and not found in getAll, use the first id.
  for (const org of orgs) {
    for (const team of org.teams ?? []) {
      const first = (team.projects ?? [])[0]?.id;
      if (first) return first;
    }
  }
  return null;
}

/** Given the project has the Twilio credentials that let it place a call. */
export async function givenTheProjectHasTwilio(page: Page, creds: PhoneCreds) {
  await ensureProviderKey(page, {
    provider: "twilio",
    customKeys: {
      TWILIO_ACCOUNT_SID: creds.accountSid,
      TWILIO_AUTH_TOKEN: creds.authToken,
      TWILIO_FROM_NUMBER: creds.fromNumber,
    },
  });
}

/** Given the project has the ElevenLabs credential that signs a session. */
export async function givenTheProjectHasElevenLabs(
  page: Page,
  creds: ElevenLabsCreds,
) {
  await ensureProviderKey(page, {
    provider: "elevenlabs",
    customKeys: { ELEVENLABS_API_KEY: creds.apiKey },
  });
}

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
 * dialog, starts the run, and waits for the run drawer to open on it.
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
// Then: the call, the verdict, the transcript, the audio, the traces
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

/** How long to keep retrying a `404` while the provider finishes publishing the recording. */
const WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS = 120_000;

/** Delay between polls of the whole-call audio endpoint. */
const WHOLE_CALL_AUDIO_POLL_INTERVAL_MS = 5_000;

/**
 * Then they can listen to the whole call.
 *
 * `WholeCallAudio` renders its `<audio>` element with `preload="none"`, so
 * the browser never requests the recording until a user presses play. That
 * means `onError` never fires and the `run-call-audio-unavailable` fallback
 * never appears just because the element is on the page — the previous form
 * of this step, which only asserted visibility, passed for every run,
 * including ones whose recording endpoint returned a 404 and had no audio
 * at all. Visibility is still a legitimate precondition, but proving they
 * can actually listen requires fetching the `src` the play button would
 * hit and checking it is real, playable audio.
 *
 * The provider publishes whole-call audio asynchronously, only once it has
 * finished processing the recording after the call ends. A `404` seen right
 * after a run settles is therefore expected and transient — it is the same
 * condition the `run-call-audio-retry` control in `WholeCallAudio.tsx` exists
 * to handle — so this step polls the endpoint the way a user pressing retry
 * would, bounded at `WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS`. Only a `404` is
 * retried: any other non-200 status is a genuine failure and fails the step
 * immediately rather than being retried until the deadline.
 */
export async function thenTheyCanListenToTheWholeCall(page: Page) {
  const audio = page.getByTestId("run-call-audio");
  await expect(audio).toBeVisible({ timeout: CALL_VERDICT_TIMEOUT_MS });

  const src = await audio.getAttribute("src");
  expect(src, "run-call-audio has no src").toBeTruthy();
  const audioUrl = new URL(src!, page.url()).toString();

  // `page.request.get` carries the browser's session cookies, so this hits
  // the same authenticated endpoint the user's play button would.
  const deadline = Date.now() + WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS;
  let response = await page.request.get(audioUrl);
  while (response.status() === 404 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, WHOLE_CALL_AUDIO_POLL_INTERVAL_MS));
    response = await page.request.get(audioUrl);
  }
  if (response.status() === 404) {
    throw new Error(
      `whole-call recording never became available within ${WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS}ms (last status: 404)`,
    );
  }
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/audio\//);

  // Read the actual byte length rather than trusting `content-length`,
  // which may be absent on a streamed response.
  const body = await response.body();
  expect(body.byteLength).toBeGreaterThanOrEqual(1000);
}

/** Then they can listen to each part of the conversation. */
export async function thenEachTurnHasAudio(page: Page) {
  await expect(page.getByTestId("media-part-audio").first()).toBeVisible({
    timeout: CALL_VERDICT_TIMEOUT_MS,
  });
}

/**
 * Then they can see the threads and traces for their agent and for the runner.
 * Both affordances live in the run drawer's "More actions" overflow menu.
 */
export async function thenTheyCanReachThreadsAndTraces(page: Page) {
  await page.getByRole("button", { name: /more actions/i }).click();
  await expect(page.getByText(/open thread/i)).toBeVisible();
  await expect(page.getByText(/view in traces explorer/i)).toBeVisible();
  // Close the menu again so it does not sit over later interactions.
  await page.keyboard.press("Escape");
}

/**
 * The traces explorer URL that `whenTheyFollowTheTracesLink` last settled on,
 * including the `#all-traces?q=scenarioRun:"<id>"` hash. `reopenTheOneTrace`
 * restores this exact URL if a later step's `Escape` pops the app back to
 * Agent Testing, since a hand-built URL could silently drop the
 * `scenarioRun` filter and make the one-trace assertion vacuous — only a URL
 * the app itself produced is trustworthy here.
 */
let lastTracesExplorerUrl: string | undefined;

/**
 * When they follow the traces link: "View in Traces Explorer" pushes
 * /<slug>/traces#all-traces?q=scenarioRun:"<id>".
 *
 * The URL poll only proves the address bar changed, not that the traces
 * explorer actually rendered — the run drawer is a dialog that can still be
 * open and covering the page at that instant. So this also waits for the
 * trace table itself (`tbody[data-trace-id]`) to attach before recording the
 * settled URL, matching the 60s ingestion-lag timeout used elsewhere for the
 * same table.
 */
export async function whenTheyFollowTheTracesLink(page: Page) {
  await page.getByRole("button", { name: /more actions/i }).click();
  await page.getByText(/view in traces explorer/i).click();
  await expect
    .poll(() => page.url(), { timeout: 15_000 })
    .toMatch(/\/traces#all-traces\?q=scenarioRun/);
  await expect(page.locator("tbody[data-trace-id]").first()).toBeAttached({
    timeout: 60_000,
  });
  lastTracesExplorerUrl = page.url();
}

/**
 * Then the call is one trace for its whole length: the scenarioRun filter shows
 * exactly one trace row.
 *
 * Each trace in the traces-v2 explorer table is its own `<tbody
 * data-trace-id>` (StatusRow.tsx:136 / TraceLensBody.tsx:241) — counting
 * `getByRole("row")` would be wrong, since it also counts the header row and
 * any addon rows nested inside a single trace's tbody.
 */
export async function thenTheCallIsOneTrace(page: Page) {
  const traceRows = page.locator("tbody[data-trace-id]");
  // The traces explorer first renders the project's unfiltered trace list,
  // then applies the `q=scenarioRun:"<id>"` filter from the URL hash once it
  // round-trips to the trace store. Polling `toBeGreaterThan(0)` before
  // asserting `toBe(1)` is racy: the unfiltered list satisfies the first poll
  // immediately, so the hard assertion then runs against the pre-filter
  // render. Poll straight to `toBe(1)` instead, so the assertion only passes
  // once the filtered count actually settles. This stays non-vacuous: a call
  // that fans out into several traces settles at 2+ and never reaches 1, and
  // a filter that matches nothing stays at 0 — both still fail correctly.
  // A 60s timeout gives ingestion time to lag a just-finished call.
  await expect
    .poll(async () => traceRows.count(), {
      timeout: 60_000,
      message: "expected exactly one trace under the scenarioRun filter",
    })
    .toBe(1);
}

/**
 * Switch the open trace drawer to the "Trace" view, where the span waterfall
 * (`data-testid="waterfall-row"`) renders. No-op if a waterfall row is
 * already visible, since callers that arrive here after another view has
 * already switched (audio-then-metadata in the ElevenLabs journey, metadata
 * only in the Twilio journey) must not depend on step order. Anchored regex
 * so the click can't accidentally match "Conversation" or the header's
 * "Copy trace ID" / "Share trace" / "Refresh trace" buttons.
 *
 * Takes `page` rather than a `Locator` and derives the dialog itself, because
 * the drawer can close or re-render between steps: the switcher-button wait
 * uses a short timeout, and if it fails this calls `reopenTheOneTrace` once
 * and retries the wait-and-click a single time. One recovery attempt is
 * enough — a second failure surfaces as a real error rather than hanging
 * behind further retries.
 */
async function showTraceWaterfall(page: Page) {
  const dialog = page.getByRole("dialog");
  const alreadyOnWaterfall = await dialog
    .getByTestId("waterfall-row")
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyOnWaterfall) return;

  const switcher = dialog.getByRole("button", { name: /^Trace\b/ });
  try {
    await expect(switcher).toBeVisible({ timeout: 5_000 });
  } catch {
    await reopenTheOneTrace(page);
    await expect(switcher).toBeVisible({ timeout: 5_000 });
  }
  await switcher.click();
}

/**
 * Switch the open trace drawer to the "Conversation" view, where the span
 * content is walked directly by `collectMediaParts`
 * (`src/features/traces-v2/components/TraceDrawer/transcript/parsing.ts`)
 * and playable audio (`data-testid="media-part-audio"`) renders. No-op if
 * the media strip is already visible — for this view, that element is
 * exactly what callers assert on next, so "already visible" is a legitimate
 * fast path rather than a claim about anything else. Anchored regex so the
 * click can't accidentally match "Conversation" prefixes elsewhere or other
 * buttons.
 *
 * Takes `page` rather than a `Locator` and derives the dialog itself, for the
 * same reason as `showTraceWaterfall`: the drawer can vanish or re-render
 * mid-interaction, so the switcher-button wait gets one `reopenTheOneTrace`
 * recovery attempt before a second failure is allowed to surface as a real
 * error.
 */
async function showTraceConversation(page: Page) {
  const dialog = page.getByRole("dialog");
  const alreadyOnConversation = await dialog
    .getByTestId("media-part-audio")
    .first()
    .isVisible()
    .catch(() => false);
  if (alreadyOnConversation) return;

  const switcher = dialog.getByRole("button", { name: /^Conversation\b/ });
  try {
    await expect(switcher).toBeVisible({ timeout: 5_000 });
  } catch {
    await reopenTheOneTrace(page);
    await expect(switcher).toBeVisible({ timeout: 5_000 });
  }
  await switcher.click();
}

/**
 * Dismiss whatever drawer a previous step left behind, if any, and open the
 * single filtered trace fresh. The two journeys visit these steps in
 * different orders, and a drawer a prior assertion opened is not reliable
 * state to inherit — it can already be gone by the time the next step runs.
 * So this never trusts leftover drawer state: it closes whatever dialog is
 * currently open (tolerating the case where nothing is), then clicks the
 * trace row to open a fresh one.
 */
async function reopenTheOneTrace(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
  }

  // The run drawer is route-driven, not a plain overlay: closing it with
  // `Escape` above pops the app back to the Agent Testing route (the
  // scenarios list), discarding the traces explorer URL entirely. Check the
  // route AFTER the `Escape`, since the `Escape` is what can cause the
  // navigation, and restore the URL `whenTheyFollowTheTracesLink` recorded if
  // the app has left the traces explorer. Restoring at most once keeps this
  // from masking a genuinely broken navigation loop.
  if (!/\/traces#all-traces\?q=scenarioRun/.test(page.url())) {
    if (!lastTracesExplorerUrl) {
      throw new Error(
        "reopenTheOneTrace: left the traces explorer and no traces URL was recorded to return to"
      );
    }
    await page.goto(lastTracesExplorerUrl);
  }

  // The traces explorer first renders the project's unfiltered trace list,
  // then applies the `q=scenarioRun:"<id>"` filter from the URL hash once it
  // round-trips to the trace store (see `thenTheCallIsOneTrace`). The
  // ElevenLabs journey reaches this step without a prior `toBe(1)` settling
  // assertion, so this helper cannot assume the filtered row is already on
  // screen — it must wait for the row itself, not just find it. A 60s
  // timeout matches the ingestion-lag rationale on `thenTheCallIsOneTrace`.
  const traceRow = page.locator("tbody[data-trace-id]").first();
  await expect(traceRow).toBeVisible({ timeout: 60_000 });
  await traceRow.click();

  await expect(dialog).toBeVisible({ timeout: 15_000 });
}

/**
 * Open the single filtered trace (see thenTheCallIsOneTrace) and wait for its
 * drawer to render. Clicking the trace's `<tbody>` row calls
 * openDrawer("traceV2Details", ...) (TraceLensBody.tsx:242,
 * useOpenTraceDrawer.ts:227), which writes drawer.open/drawer.traceId into
 * the URL query rather than pushing a route, so the observable effect is the
 * drawer (Chakra Drawer.Content, role="dialog") appearing. It opens on the
 * "Summary" view (drawerStore.ts:352), not the waterfall — the waterfall
 * span rows live behind the "Trace" view-switcher button inside the dialog.
 * The dialog-open check short-circuits on repeat calls, but the view switch
 * must run every time regardless: step order differs between the phone and
 * ElevenLabs journeys, so a prior step (e.g. the audio step, which needs
 * Summary) may have left the drawer on a different view than this call
 * needs.
 */
async function openTheOneTrace(page: Page) {
  const dialog = page.getByRole("dialog");
  if (!(await dialog.isVisible().catch(() => false))) {
    const traceRow = page.locator("tbody[data-trace-id]").first();
    await expect(traceRow).toBeVisible({ timeout: 30_000 });
    await traceRow.click();

    await expect(dialog).toBeVisible({ timeout: 15_000 });
  }

  await showTraceWaterfall(page);

  // Longer timeout than the dialog wait above: the span tree fetches after
  // the view switch.
  await expect(dialog.getByTestId("waterfall-row").first()).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Expand the open span's "Attributes" accordion section if it is not already
 * expanded. The section's trigger is an Ark/Chakra accordion button scoped
 * under `[data-section="attributes"]` (AccordionShell.tsx, SpanAccordions.tsx:421)
 * and carries the usual `aria-expanded` state.
 */
async function ensureAttributesSectionOpen(dialog: Locator) {
  const trigger = dialog
    .locator('[data-section="attributes"]')
    .getByRole("button")
    .first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

/**
 * Click through the open trace's waterfall rows (TreeRow.tsx:392,
 * data-testid="waterfall-row") to find the span whose Attributes accordion
 * exposes `attributeText`. Attribute keys render verbatim, with no testid, in
 * AttributeTable (SpanAccordions.tsx:421-442, AttributeTable.tsx:756-764), so
 * the check is a text match once the section is open.
 *
 * Prefers the row(s) matching `nameMatch` first, then falls back to scanning
 * every row — the row's visible name is not guaranteed to expose the span
 * kind, so a name match is a fast path, not the only path. Returns whether a
 * row exposing the attribute was found and left selected/open.
 *
 * Switches to the "Trace" view itself rather than trusting the drawer's
 * current state: callers run after other steps whose order varies by
 * journey (the ElevenLabs journey checks audio, which needs "Summary",
 * before metadata, which needs this), so the waterfall may not be showing.
 * Uses the resilient `showTraceWaterfall(page)` so a drawer that vanished or
 * re-rendered between steps gets re-established before the rows are waited
 * on, rather than timing out against a dialog that is no longer there.
 */
async function selectSpanExposingAttribute(
  page: Page,
  { nameMatch, attributeText }: { nameMatch: RegExp; attributeText: string | RegExp },
): Promise<boolean> {
  await showTraceWaterfall(page);
  const dialog = page.getByRole("dialog");
  const rows = dialog.getByTestId("waterfall-row");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  const isAttributeVisible = () =>
    dialog.getByText(attributeText).first().isVisible().catch(() => false);

  const trySelect = async (row: Locator) => {
    await row.click();
    await ensureAttributesSectionOpen(dialog);
    return isAttributeVisible();
  };

  const named = rows.filter({ hasText: nameMatch });
  if ((await named.count()) > 0 && (await trySelect(named.first()))) {
    return true;
  }

  const total = await rows.count();
  for (let i = 0; i < total; i++) {
    if (await trySelect(rows.nth(i))) return true;
  }
  return false;
}

/**
 * Then the traces carry the audio and they can listen to it there. The call
 * audio really is present in the span data, as chat-message file parts
 * shaped `{"type":"file","mediaType":"audio/pcm16","data":"<base64>"}`
 * inside `langwatch.input` / `langwatch.output`, and `audio/pcm16` is
 * WAV-wrapped for real playback (`pcmToWav.ts:129-161`), so it is genuinely
 * listenable.
 *
 * This asserts against the "Conversation" view rather than "Summary". The
 * Summary strip is fed from a compact ingest-time reference cache, and
 * `collectMediaRefs` (`src/shared/traces/media-refs.ts:103-131`) keeps a
 * part only when its resolved source is a stored-object URL — inline base64
 * audio is dropped by design there, to avoid re-bloating summary rows. That
 * is deliberate product policy, not a bug to work around from this test. The
 * "Conversation" view instead walks the span content directly via
 * `collectMediaParts`
 * (`src/features/traces-v2/components/TraceDrawer/transcript/parsing.ts`)
 * and genuinely renders the playable audio, so it is the honest surface for
 * this contract.
 *
 * This step must not depend on the drawer's previous state at all: a
 * Playwright snapshot taken the moment this step once failed showed no
 * dialog anywhere on the page, because a drawer a prior assertion had left
 * open was already gone by the time this step ran. So this calls
 * `reopenTheOneTrace` to establish a known-good drawer fresh, rather than
 * trusting whatever `openTheOneTrace` or an earlier step left behind, then
 * switches to "Conversation" before asserting on the audio element.
 */
export async function thenTheTracesCarryTheAudio(page: Page) {
  await reopenTheOneTrace(page);
  await showTraceConversation(page);

  const dialog = page.getByRole("dialog");
  const audio = dialog.getByTestId("media-part-audio");
  await expect(audio.first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Then the traces carry the Twilio call metadata: with the trace open, the
 * span that dialed out exposes `voice.twilio.call_sid` in its Attributes
 * section.
 */
export async function thenTheTraceCarriesTwilioMetadata(page: Page) {
  await openTheOneTrace(page);
  const attributeText = "voice.twilio.call_sid";
  const found = await selectSpanExposingAttribute(page, {
    nameMatch: /voice\.adapter\.dial|voice\.adapter\.connect/,
    attributeText,
  });
  expect(found).toBe(true);
  await expect(
    page.getByRole("dialog").getByText(attributeText),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Then the traces carry all the metadata the call makes available
 * (ElevenLabs). Prefers the known key `voice.elevenlabs.conversation_id`;
 * if no span exposes that exact key, falls back to asserting the Attributes
 * section renders some `voice.`-prefixed key at all, since the ElevenLabs
 * contract names no specific key.
 */
export async function thenTheTraceCarriesCallMetadata(page: Page) {
  await openTheOneTrace(page);
  const nameMatch = /voice\.adapter\.dial|voice\.adapter\.connect|elevenlabs/i;

  const foundConversationId = await selectSpanExposingAttribute(page, {
    nameMatch,
    attributeText: "voice.elevenlabs.conversation_id",
  });
  if (foundConversationId) {
    await expect(
      page.getByRole("dialog").getByText("voice.elevenlabs.conversation_id"),
    ).toBeVisible({ timeout: 10_000 });
    return;
  }

  const foundAny = await selectSpanExposingAttribute(page, {
    nameMatch,
    attributeText: /^voice\./,
  });
  expect(foundAny).toBe(true);
  await expect(
    page.getByRole("dialog").getByText(/^voice\./).first(),
  ).toBeVisible({ timeout: 10_000 });
}
