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

/** Delay between polls of the whole-call audio endpoint. */
export const WHOLE_CALL_AUDIO_POLL_INTERVAL_MS = 5_000;

/**
 * How long to wait for a just-finished call's trace(s) to ingest and appear,
 * correctly filtered, in the traces explorer.
 */
export const TRACE_INGESTION_TIMEOUT_MS = 60_000;
