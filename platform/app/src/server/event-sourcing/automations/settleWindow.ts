/**
 * The settle-window bucket (ADR-098 decision 4, ADR-026).
 *
 * Ordering on the dispatch plane is best effort, so an effect must fire on
 * *converged* state — a settle window that has stopped moving — rather than
 * on the first observation of a transition. A trace that keeps producing
 * spans must keep re-arming its trigger's evaluation instead of firing once
 * per span; a trace that stops producing spans must eventually settle and
 * fire exactly once for that round.
 *
 * `settleWindowBucket` names the round: two occurrences that fall in the same
 * bucket are the *same* round (duplicate activity, or a redelivery) and must
 * collapse; two occurrences in different buckets are different rounds, each
 * entitled to its own evaluation. Bucketing on wall-clock-since-epoch rather
 * than "time since first activity" is what makes the bucket a pure function
 * of `(occurredAt, traceDebounceMs)` — no prior state to consult, so the same
 * event always names the same round no matter how many times it is
 * redelivered or in what order.
 */
export function settleWindowBucket({
  occurredAt,
  traceDebounceMs,
}: {
  occurredAt: number;
  traceDebounceMs: number;
}): string {
  // A zero debounce still needs a non-zero divisor: one-millisecond buckets
  // collapse only exact-same-millisecond redeliveries while leaving every
  // later millisecond of eager activity free to open a new round.
  const bucketIndex = Math.floor(occurredAt / Math.max(traceDebounceMs, 1));
  // The configured width rides along in the bucket id. Two rounds with equal
  // indexes but different debounce settings must never collide — changing a
  // trigger's debounce mid-flight must not let a later round silently reuse
  // an earlier round's identity.
  return `${traceDebounceMs}-${bucketIndex}`;
}
