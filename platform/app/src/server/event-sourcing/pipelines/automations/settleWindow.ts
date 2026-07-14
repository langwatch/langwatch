export function settleWindowBucket({
  occurredAt,
  traceDebounceMs,
}: {
  occurredAt: number;
  traceDebounceMs: number;
}): string {
  // Legacy enqueueSettle deduplicated for traceDebounceMs, then allowed the
  // same trigger and trace to re-arm after that TTL. Event keys cannot expire,
  // so deterministic buckets of the same width preserve that bounded collapse.
  // Include the configured width so changing a trigger's debounce cannot reuse
  // a permanent event key from a completed round with a different window size.
  // A zero debounce uses one-millisecond buckets: exact redeliveries collapse
  // while later eager activity remains eligible for a new evaluation round.
  const bucketIndex = Math.floor(occurredAt / Math.max(traceDebounceMs, 1));
  return `${traceDebounceMs}-${bucketIndex}`;
}
