/**
 * Audio assertions for the voice-agent contract steps.
 *
 * Covers proving the call is genuinely listenable: the whole-call recording,
 * and per-turn audio for each conversation part that carries it.
 *
 * @see ../voice-agent-contract.spec.ts
 */
import { type Page, expect } from "@playwright/test";

import {
  CALL_VERDICT_TIMEOUT_MS,
  WHOLE_CALL_AUDIO_POLL_INTERVAL_MS,
  WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS,
} from "./constants";

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

/**
 * Then they can listen to each part of the conversation.
 *
 * Every rendered conversation part that can carry audio, not just one
 * anywhere on the page: the previous form of this assertion used `.first()`,
 * which only proves one `<audio>` control exists somewhere in the drawer —
 * it stays green even if every turn after the first one is missing its
 * recording.
 *
 * `ScenarioMessageRenderer.tsx` marks each "media" display item (the kind
 * that can render an `<audio>` via `MediaPart.tsx`) with a `data-media-align`
 * attribute on its wrapping element; plain text bubbles, images, and tool
 * call/result blocks never carry that attribute and never render an
 * `<audio>` element at all (`MediaPart.tsx` only emits one when
 * `category === "audio"`). Those kinds are excluded from this check on
 * purpose — they are not "parts of the conversation" a caller hears, they
 * are transcript, image, or tooling detail — rather than being silently
 * skipped to make the assertion pass.
 *
 * Asserts the part count is non-zero before looping, so this cannot pass
 * vacuously against an empty conversation, and scopes each audio lookup to
 * its own part rather than the whole page.
 */
export async function thenEachTurnHasAudio(page: Page) {
  const body = page.getByTestId("run-drawer-conversation-body");
  const audioParts = body.locator("[data-media-align]");

  await expect(audioParts.first()).toBeVisible({ timeout: CALL_VERDICT_TIMEOUT_MS });
  const count = await audioParts.count();
  expect(count, "expected at least one conversation part to render").toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    await expect(audioParts.nth(i).getByTestId("media-part-audio")).toBeVisible({
      timeout: CALL_VERDICT_TIMEOUT_MS,
    });
  }
}
