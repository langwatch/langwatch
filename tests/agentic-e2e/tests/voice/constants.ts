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

/** How long to keep retrying a `404` while the provider finishes publishing the recording. */
export const WHOLE_CALL_AUDIO_POLL_TIMEOUT_MS = 120_000;

/**
 * The provider publishes the whole-call recording asynchronously after the
 * call ends, so a `404` is expected right after a run settles. Five seconds
 * gives the provider real processing time between retries — polling faster
 * just burns requests against an endpoint that has not finished yet.
 */
export const WHOLE_CALL_AUDIO_POLL_INTERVAL_MS = 5_000;

/**
 * Upper bound on how many rendered conversation parts `thenEachTurnHasAudio`
 * budgets a full `CALL_VERDICT_TIMEOUT_MS` wait for, when the test's overall
 * `test.setTimeout` sums up its steps' worst-case waits. The per-part loop
 * itself has no hard cap — it iterates every part the call actually
 * rendered — but the timeout budget must be a finite, named sum rather than
 * "however many parts show up," so this is the number of parts the budget
 * accounts for. A real voice-agent scenario in this suite renders only a
 * handful of turns, so this comfortably covers the expected case; a call
 * that legitimately renders more parts than this is expected to fail on the
 * test's overall timeout rather than silently understating the budget.
 */
export const MAX_AUDIO_PARTS_BUDGETED = 3;

/**
 * How long to wait for a just-finished call's trace(s) to ingest and appear,
 * correctly filtered, in the traces explorer.
 */
export const TRACE_INGESTION_TIMEOUT_MS = 60_000;
