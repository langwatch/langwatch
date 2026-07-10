/**
 * The fold (ADR-039 Decision 3/4): the billable gauge is the sum of signed
 * boundary-event deltas. Entries/seeds carry positive deltas, exits and
 * corrections negative ones — the sign lives on the event, set by its
 * emitter; the fold only ever adds.
 *
 * The fold deliberately does NOT clamp: signed deltas are legitimate
 * (un-merged ReplacingMergeTree versions can make a daily delta negative),
 * so a gauge may transiently dip below zero on a small org. The
 * never-negative guard applies at the sampling boundary
 * (max(0, ceil(bytes/MiB))), and a gauge negative beyond tolerance raises a
 * drift alarm — clamping here would hide exactly the drift the audit exists
 * to catch.
 */
export function foldBoundaryEvents({
  initialBytes,
  events,
}: {
  initialBytes: bigint;
  events: readonly { deltaBytes: bigint }[];
}): bigint {
  return events.reduce((gauge, event) => gauge + event.deltaBytes, initialBytes);
}
