import type { AutomationPersistCapDecision } from "@langwatch/automation-contract";
import { Temporal, type Instant } from "@langwatch/time";

const DAY_MS = 86_400_000;

/** The UTC day a slot is counted in; the ceiling resets when it changes. */
export function derivePersistCapDay(now: Instant): number {
  return Math.floor(now.epochMilliseconds / DAY_MS);
}

/**
 * The instant a confirmed match is counted at: when its trace occurred, so a
 * replayed backlog fills each past day's counter rather than today's. A trace
 * dated after `now` (an SDK clock ahead of ours) counts at `now`, so nothing
 * lands in tomorrow's counter (#8893).
 */
export function persistCapBucketInstant({
  occurredAtMs,
  now,
}: {
  occurredAtMs: number;
  now: Instant;
}): Instant {
  // A missing time (0, negative, NaN) counts at `now` too, never in day 0.
  if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0 || occurredAtMs >= now.epochMilliseconds) {
    return now;
  }
  return Temporal.Instant.fromEpochMilliseconds(occurredAtMs);
}

/** Counting continues past the cap, so `skipped` is the customer-visible overshoot. */
export function decidePersistCap({
  count,
  cap,
}: {
  count: number;
  cap: number;
}): AutomationPersistCapDecision {
  return { allowed: count <= cap, count, cap, skipped: Math.max(0, count - cap) };
}
