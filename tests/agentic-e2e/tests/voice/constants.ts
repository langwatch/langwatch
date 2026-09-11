/**
 * Shared timeout constants for the voice-agent contract steps.
 *
 * Kept in one module because `voice-agent-contract.spec.ts` derives each
 * test's overall `test.setTimeout` from the same constants the steps below
 * actually wait on — a separately hardcoded total could silently drift out
 * of sync with the sum of its own phases.
 */

/**
 * A real voice call takes time to place, hold, and hang up before the judge
 * can read it. Two minutes is the ceiling a call is expected to need, so the
 * verdict wait is given a generous margin above it rather than the suite's
 * default 10s expect timeout — a run that is still on the phone is working,
 * not hung.
 */
export const CALL_VERDICT_TIMEOUT_MS = 180_000;

/** How long to wait for the call to start (leave the queued state). */
export const CALL_START_TIMEOUT_MS = 60_000;

/**
 * How long to keep retrying a `404` before giving up on the whole-call
 * recording.
 *
 * This wait covers two asynchronous stages in sequence, not one. The run's
 * audio endpoint does not hold the vendor's recording handle directly: it
 * resolves it by reading the run's own trace spans back out of storage. So
 * the run's spans must finish ingesting before the endpoint can resolve
 * anything, and only then can the vendor's recording have finished
 * publishing. A `404` is ambiguous between the two.
 *
 * It is therefore set above `TRACE_INGESTION_TIMEOUT_MS`, the allowance the
 * trace steps get for that same ingestion, leaving real vendor publish time
 * on top.
 *
 * Raising this is not a cure for a `404` that persists. A run whose spans
 * never carry a recording handle at all will sit at `404` for any ceiling,
 * because there is nothing for the endpoint to resolve — that is a defect in
 * the run, and this step is meant to fail loudly on it rather than wait it
 * out.
 */
export const WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS = 120_000;

/**
 * The provider publishes the whole-call recording asynchronously after the
 * call ends, so a `404` is expected right after a run settles. Five seconds
 * gives the provider real processing time between retries — polling faster
 * just burns requests against an endpoint that has not finished yet.
 */
export const WHOLE_CALL_AUDIO_POLL_INTERVAL_MS = 5_000;

/**
 * How many rendered conversation parts `thenEachTurnHasAudio` will wait a full
 * `CALL_VERDICT_TIMEOUT_MS` for.
 *
 * This is an enforced cap, not just a budgeting figure. `thenEachTurnHasAudio`
 * asserts the rendered part count against it BEFORE entering its per-part
 * loop, so the loop can never wait more times than the enclosing
 * `test.setTimeout` budgeted for. It used to be budget-only, and the mismatch
 * was a trap: a call rendering a fourth part would spend a legitimate per-part
 * wait outside the test's budget and die on the generic overall timeout, which
 * says nothing about audio. Now it fails as an audio assertion naming the
 * count it actually saw.
 *
 * A real voice-agent scenario in this suite renders a handful of turns, so
 * three comfortably covers the expected case. If a legitimate scenario here
 * ever needs more, raise this one number — the journey budgets below follow
 * it.
 */
export const MAX_AUDIO_PARTS_BUDGETED = 3;

/**
 * How long to wait for a just-finished call's trace(s) to ingest and appear,
 * correctly filtered, in the traces explorer.
 */
export const TRACE_INGESTION_TIMEOUT_MS = 60_000;

/**
 * UI settle time not covered by any single phase constant above: page
 * navigation, scenario authoring, provider setup, the run dialog, and the
 * trace drawer's own short (5-15s) internal waits. Named rather than folded
 * into one of the phase constants, so a future phase change doesn't have to
 * hunt for where the slack was hiding.
 */
export const SETUP_MARGIN_MS = 60_000;

/**
 * The phone journey's overall wall-clock budget.
 *
 * The honest sum of every sequential await downstream that can legitimately
 * need its full ceiling — not just one occurrence of each constant:
 *
 *   CALL_START_TIMEOUT_MS               x1  thenTheCallIsPlaced
 *   CALL_VERDICT_TIMEOUT_MS             x1  thenASimulatedUserTalksToTheAgent
 *   CALL_VERDICT_TIMEOUT_MS             x1  thenTheRunIsJudgedAgainstCriteria
 *   CALL_VERDICT_TIMEOUT_MS             x1  thenTheyCanListenToTheWholeCall
 *                                             (audio element visible)
 *   WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS    x1  thenTheyCanListenToTheWholeCall
 *                                             (recording-publish poll)
 *   CALL_VERDICT_TIMEOUT_MS             x1  thenEachTurnHasAudio
 *                                             (first part visible)
 *   CALL_VERDICT_TIMEOUT_MS x MAX_AUDIO_PARTS_BUDGETED  thenEachTurnHasAudio
 *                                             (per-part waits, capped by that
 *                                             step's own assertion)
 *   TRACE_INGESTION_TIMEOUT_MS          x3  whenTheyFollowTheTracesLink,
 *                                             thenTheCallIsOneTrace,
 *                                             thenTheTracesCarryTheAudio
 *                                             (via reopenTheOneTrace)
 *   SETUP_MARGIN_MS                     x1  everything else
 *
 * Computed here rather than in the spec so the arithmetic sits with the values
 * it sums, and so the sum is a named constant rather than an expression built
 * from imports.
 */
export const PHONE_JOURNEY_TIMEOUT_MS =
  CALL_START_TIMEOUT_MS +
  CALL_VERDICT_TIMEOUT_MS * (4 + MAX_AUDIO_PARTS_BUDGETED) +
  WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS +
  TRACE_INGESTION_TIMEOUT_MS * 3 +
  SETUP_MARGIN_MS;

/**
 * The ElevenLabs journey's overall wall-clock budget.
 *
 * The same sequential sum as {@link PHONE_JOURNEY_TIMEOUT_MS} minus two terms:
 * this journey has no separate call-placement phase (there is no queued state
 * to leave before ElevenLabs joins), so it omits `CALL_START_TIMEOUT_MS`, and
 * it never calls `thenTheCallIsOneTrace`, so it pays
 * `TRACE_INGESTION_TIMEOUT_MS` twice rather than three times.
 */
export const ELEVENLABS_JOURNEY_TIMEOUT_MS =
  CALL_VERDICT_TIMEOUT_MS * (4 + MAX_AUDIO_PARTS_BUDGETED) +
  WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS +
  TRACE_INGESTION_TIMEOUT_MS * 2 +
  SETUP_MARGIN_MS;
