/**
 * Trace span attribute assertions for the voice-agent contract steps.
 *
 * Covers selecting the span that carries a given attribute in the waterfall,
 * and the assertions built on that: the traces carry playable audio, and the
 * traces carry the provider's call metadata.
 *
 * @see ../voice-agent-contract.spec.ts
 * @see ./trace-navigation.ts
 */
import { type Locator, type Page, expect } from "@playwright/test";

import {
  openTheOneTrace,
  reopenTheOneTrace,
  showTraceConversation,
  showTraceWaterfall,
} from "./trace-navigation";

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
