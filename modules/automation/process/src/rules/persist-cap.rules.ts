import type { AutomationPersistCapDecision } from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";

const DAY_MS = 86_400_000;

/** The UTC day a slot is counted in; the ceiling resets when it changes. */
export function derivePersistCapDay(now: Instant): number {
  return Math.floor(now.epochMilliseconds / DAY_MS);
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
