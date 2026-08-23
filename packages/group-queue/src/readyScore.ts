/**
 * A ready score is a dispatch-eligibility time, and for the highest-volume
 * producers it is a value the CUSTOMER supplies: `recordDataPoint`,
 * `contributeMetricFacts` and `contributeLogFacts` all score off an OTLP
 * `timeUnixNano`, and nothing clamps it on ingest. So the score's domain is not
 * "roughly now", it is "any number a client's clock can emit", and it has to be
 * judged against the clock we are staging on rather than against a constant.
 *
 * Both directions cause a distinct, observed failure:
 *
 *   too far in the past   - the job sits permanently at the head of its group
 *                           and never yields, and `now - score` is reported as
 *                           the queue's backlog age. A fixed floor does not
 *                           bound this: a tenant shipping logs stamped
 *                           2021-01-01 clears any floor set below it and still
 *                           reads as ~5 years of backlog.
 *   too far in the future - dispatch scans `ZRANGEBYSCORE readyKey "-inf" now`,
 *                           so a score of 2030 makes the group invisible to
 *                           dispatch until 2030 while its jobs keep counting
 *                           against `totalPending`. A tenant with a fast clock
 *                           can park their own ingestion.
 *
 * Same shape and vocabulary as `MAX_ANCHOR_FUTURE_SKEW_MS` / `isUsableAnchorMs`
 * in `traceAnalytics.foldProjection.ts` (ADR-071), which exists for exactly this
 * "the value is producer-controlled" problem. The two should read as one idea.
 */

/**
 * How far behind the staging clock a producer's score may sit and still be used
 * verbatim.
 *
 * A day, matching the anchor bound: telemetry is legitimately batched and
 * exported late, and a whole day of lateness should still dispatch in its own
 * occurrence order rather than being flattened onto arrival order. Beyond that
 * the value stops looking like "when this happened" and starts looking like a
 * broken clock, and the cost of trusting it (a permanent queue-head squatter,
 * an age gauge reporting years) outweighs the ordering we would preserve.
 */
export const MAX_SCORE_PAST_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead of the staging clock a producer's score may sit.
 *
 * Much tighter than the past bound, and deliberately tighter than the anchor's
 * day. The anchor records a customer's own business time for storage, where a
 * day of skew costs nothing but a partition; a ready score decides WHEN WE DO
 * THE WORK, so every millisecond of tolerated future skew is a millisecond we
 * defer our own pipeline on a client's say-so.
 *
 * Queue definitions use occurrence or creation times for ordering. Deliberate
 * deferral is expressed as `delay`, which is added after the score is resolved,
 * and retry paths compute their own future scores. Five minutes is therefore
 * clock-skew allowance for an unsynchronised producer, not scheduling policy.
 */
export const MAX_SCORE_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Absolute backstop: below this (2020-09-13, years before this queue existed) a
 * value is not a wall-clock timestamp at all, whatever the relative bounds say.
 *
 * The relative bounds cannot catch every case on their own, because they are
 * measured against a clock that can itself be wrong. A worker that boots before
 * its NTP sync reads `Date.now()` in 1970, and every score it stages is then
 * "plausible" relative to that. This is the check that still fails.
 *
 * Also the bound the age gauges apply when reading the ready set, where the
 * relative test is unusable: a genuine backlog IS arbitrarily far in the past,
 * so the gauge must distinguish "old" (report it) from "not a timestamp"
 * (skip it). Rows staged before this module shipped can still hold 0.
 */
export const MIN_PLAUSIBLE_EPOCH_MS = 1_600_000_000_000;

/**
 * A finite, strictly positive number - the same predicate `SpanTimingService`
 * applies to span times, and the floor every other check builds on.
 */
function isTimestampLike(value: unknown): value is number {
  return typeof value === "number" && value > 0 && Number.isFinite(value);
}

/**
 * True when `value` is a wall-clock timestamp at all, independent of any
 * clock we might compare it against.
 */
export function isPlausibleReadyScore(value: unknown): value is number {
  return isTimestampLike(value) && value >= MIN_PLAUSIBLE_EPOCH_MS;
}

/**
 * True when `score` can be used as a dispatch-eligibility time against the
 * clock reading `nowMs`: a real timestamp, not implausibly stale, and not far
 * enough ahead to hide the group from dispatch.
 *
 * `nowMs` is injected rather than read here so callers can validate a batch
 * against one shared reading, and so the bounds stay testable.
 */
export function isUsableReadyScore(
  score: unknown,
  nowMs: number,
): score is number {
  return (
    isPlausibleReadyScore(score) &&
    score >= nowMs - MAX_SCORE_PAST_SKEW_MS &&
    score <= nowMs + MAX_SCORE_FUTURE_SKEW_MS
  );
}

/**
 * The clock reading to fall back to, checked rather than trusted.
 *
 * The terminal step is validated for the same reason `firstUsableAnchor` checks
 * its own: a fallback that is assumed good is how the epoch gets in. Only the
 * absolute bound applies - `nowMs` is trivially within skew of itself - so a
 * pre-NTP clock is pinned to the backstop instead of staging 1970 out of the
 * function whose whole job is to prevent it.
 */
export function fallbackReadyScore(nowMs: number = Date.now()): number {
  return isPlausibleReadyScore(nowMs) ? nowMs : MIN_PLAUSIBLE_EPOCH_MS;
}

/**
 * Resolves a producer-supplied ready score, falling back to the staging clock
 * when the value cannot be used.
 *
 * "Now" is the honest fallback: a job whose occurrence time we cannot trust is
 * a job we are learning about now, so it should sort with its arrival and
 * report an age of zero. It degrades ordering within the group from occurrence
 * order to arrival order, and loses nothing.
 *
 * `isRejected` distinguishes the two ways of arriving at the fallback, because
 * only one of them is a defect:
 *   - absent (`undefined` / `null`): the producer has no occurrence time and
 *     never claimed to. Scoring it now is the designed default, not a repair.
 *   - present but unusable: the producer supplied something we refused. That is
 *     a broken score function, and the caller raises a counter for it.
 *
 * @param score - what the producer's score function returned, if it has one.
 * @param nowMs - the staging clock. Batch staging passes one shared value so a
 *   batch that falls back keeps its arrival order.
 */
export function resolveReadyScore({
  score,
  nowMs = Date.now(),
}: {
  score: unknown;
  nowMs?: number;
}): { score: number; isRejected: boolean } {
  if (score === undefined || score === null) {
    return { score: fallbackReadyScore(nowMs), isRejected: false };
  }
  if (isUsableReadyScore(score, nowMs)) return { score, isRejected: false };
  return { score: fallbackReadyScore(nowMs), isRejected: true };
}
