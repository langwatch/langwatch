/**
 * Lowest value a ready score can take and still be a real epoch-milliseconds
 * timestamp: 2020-09-13T12:26:40Z, years before this queue existed and far
 * above every accidental score we have seen (0, 1, a small counter, a value in
 * epoch SECONDS at ~1.7e9).
 *
 * The floor exists because a ready score is read back as an age. Anything below
 * it is a scoring bug, and `Date.now() - score` turns that bug into decades of
 * reported backlog: `gq_oldest_pending_age_milliseconds` reported ~1.786e12 ms
 * (about 56 years) in production on 2026-07-31 and 2026-08-03, from a score of
 * roughly 2 to 57,000 - a few seconds past the Unix epoch.
 */
export const MIN_PLAUSIBLE_EPOCH_MS = 1_600_000_000_000;

/**
 * True when `score` can be used as a dispatch-eligibility time.
 *
 * Deliberately stricter than a null check. `??` (the previous guard) passes 0,
 * NaN, a negative number and a Date, and every one of those either ranks a job
 * ahead of all real work or poisons the arithmetic that derives an age from it.
 */
export function isPlausibleReadyScore(score: unknown): score is number {
  return (
    typeof score === "number" &&
    Number.isFinite(score) &&
    score >= MIN_PLAUSIBLE_EPOCH_MS
  );
}

/**
 * Resolves a producer-supplied ready score, falling back to the current time
 * when it is not a usable epoch-milliseconds timestamp.
 *
 * "Now" is the honest fallback: a job whose occurrence time we cannot read is a
 * job we are learning about now, so it should sort with its arrival and report
 * an age of zero. Staging it at the epoch instead claims it has been waiting
 * since 1970, jumps it ahead of every real job in the dispatch order, and makes
 * the oldest-pending-age gauge unusable for the whole queue.
 *
 * @param score - what the producer's score function returned, if it has one.
 * @param nowMs - the fallback clock reading. Batch staging passes one shared
 *   value so a batch keeps its FIFO order.
 */
export function resolveReadyScore({
  score,
  nowMs = Date.now(),
}: {
  score: unknown;
  nowMs?: number;
}): number {
  return isPlausibleReadyScore(score) ? score : nowMs;
}
