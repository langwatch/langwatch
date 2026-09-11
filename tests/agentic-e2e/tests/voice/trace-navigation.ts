/**
 * Trace drawer navigation for the voice-agent contract steps.
 *
 * Covers reaching the trace drawer from the run drawer, following the traces
 * explorer link, asserting the call is one trace, and switching the drawer
 * between its "Trace" (waterfall) and "Conversation" views. Attribute-level
 * assertions built on top of this live in `./trace-attributes`.
 *
 * @see ../voice-agent-contract.spec.ts
 */
import { type Page, expect } from "@playwright/test";

import { TRACE_INGESTION_TIMEOUT_MS } from "./constants";

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
 * settled URL, matching the ingestion-lag timeout used elsewhere for the
 * same table.
 */
export async function whenTheyFollowTheTracesLink(page: Page) {
  await page.getByRole("button", { name: /more actions/i }).click();
  await page.getByText(/view in traces explorer/i).click();
  await expect
    .poll(() => page.url(), { timeout: 15_000 })
    .toMatch(/\/traces#all-traces\?q=scenarioRun/);
  await expect(page.locator("tbody[data-trace-id]").first()).toBeAttached({
    timeout: TRACE_INGESTION_TIMEOUT_MS,
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
  // The ingestion-lag timeout gives ingestion time to lag a just-finished call.
  await expect
    .poll(async () => traceRows.count(), {
      timeout: TRACE_INGESTION_TIMEOUT_MS,
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
export async function showTraceWaterfall(page: Page) {
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
export async function showTraceConversation(page: Page) {
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
export async function reopenTheOneTrace(page: Page) {
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
  // screen — it must wait for the row itself, not just find it. The
  // ingestion-lag timeout matches the rationale on `thenTheCallIsOneTrace`.
  const traceRow = page.locator("tbody[data-trace-id]").first();
  await expect(traceRow).toBeVisible({ timeout: TRACE_INGESTION_TIMEOUT_MS });
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
export async function openTheOneTrace(page: Page) {
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
