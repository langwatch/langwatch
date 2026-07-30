/**
 * The settle-window bucket (ADR-098 decision 4, ADR-026): the identity of one
 * round of trace activity. Two occurrences in the same bucket are the same
 * round and must collapse; two in different buckets are separate rounds, each
 * entitled to its own evaluation.
 *
 * Bucketing on wall-clock-since-epoch, not "time since first activity", is
 * what keeps it a pure function of its two arguments — the same event names
 * the same round however often it is redelivered.
 */
export function settleWindowBucket({
  occurredAt,
  traceDebounceMs,
}: {
  occurredAt: number;
  traceDebounceMs: number;
}): string {
  // A zero debounce still needs a non-zero divisor: one-millisecond buckets
  // collapse only exact-same-millisecond redeliveries.
  const bucketIndex = Math.floor(occurredAt / Math.max(traceDebounceMs, 1));
  // The configured width rides along, so changing a trigger's debounce
  // mid-flight cannot let a later round reuse an earlier round's identity.
  return `${traceDebounceMs}-${bucketIndex}`;
}
