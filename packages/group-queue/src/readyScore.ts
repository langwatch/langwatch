import { nowInstant } from "@langwatch/time";
/**
 * Dispatch-eligibility time, customer-supplied (OTLP timeUnixNano). Must clamp
 * against staging clock: too-far-past blocks job, too-far-future hides group.
 * See MAX_ANCHOR_FUTURE_SKEW_MS in traceAnalytics (ADR-071) for same pattern.
 */

/**
 * Max past skew: one day (matches anchor bound). Beyond that looks like broken
 * clock (permanent queue squatter, age gauge reporting years).
 */
export const MAX_SCORE_PAST_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Max future skew: five minutes (tighter than past bound). Clock-skew allowance
 * for unsynchronised producers; deliberate deferral goes via delay parameter.
 */
export const MAX_SCORE_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Absolute backstop (2020-09-13): catches pre-NTP clocks and invalid timestamps.
 * Applies to age gauges to distinguish "old" from "not a timestamp".
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
export function isUsableReadyScore(score: unknown, nowMs: number): score is number {
  return (
    isPlausibleReadyScore(score) &&
    score >= nowMs - MAX_SCORE_PAST_SKEW_MS &&
    score <= nowMs + MAX_SCORE_FUTURE_SKEW_MS
  );
}

/**
 * Fallback clock reading, validated against absolute bound (not relative skew).
 * Pre-NTP clocks pinned to backstop to prevent staging 1970.
 */
export function fallbackReadyScore(nowMs: number = nowInstant().epochMilliseconds): number {
  return isPlausibleReadyScore(nowMs) ? nowMs : MIN_PLAUSIBLE_EPOCH_MS;
}

/**
 * Resolves producer-supplied ready score or falls back to staging clock. Flags
 * only rejected scores (present-but-unusable), not absent (designed default).
 */
export function resolveReadyScore({
  score,
  nowMs = nowInstant().epochMilliseconds,
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
