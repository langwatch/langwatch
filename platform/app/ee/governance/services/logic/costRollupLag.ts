// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How far the daily cost rollup is behind the events it summarizes.
 *
 * Measured in BUSINESS time on both sides — the newest event's own occurredAt
 * against the newest moment any summary row covers — never in ingest time. A
 * lane that stopped folding then climbs steadily, while a lane that is merely
 * idle sits flat at zero instead of climbing with the wall clock and reading
 * as an outage.
 */
export function computeCostRollupLagMs({
  latestEventOccurredAtMs,
  latestSummarizedOccurredAtMs,
  windowStartMs,
}: {
  /** Newest cost event on the log for this lane, or null when it has none. */
  latestEventOccurredAtMs: number | null;
  /** Newest moment the summary covers, or null when it has summarized nothing. */
  latestSummarizedOccurredAtMs: number | null;
  /** Start of the window the caller asked about, the floor for an unsummarized lane. */
  windowStartMs: number;
}): number {
  // No events is not a lag. A summary cannot be behind a log with nothing in
  // it, and reporting the wall-clock distance here would make every quiet
  // deployment look like a stalled projection.
  if (latestEventOccurredAtMs === null) return 0;

  // Nothing summarized at all: the summary is behind by the whole window the
  // caller is asking about, which is the largest lag it can honestly claim
  // without knowing the age of the oldest event.
  if (latestSummarizedOccurredAtMs === null) {
    return Math.max(0, latestEventOccurredAtMs - windowStartMs);
  }

  // A summary AHEAD of the newest event is not negative lag. It happens
  // whenever an event with a later business time was folded and an earlier one
  // arrived afterwards; the summary is not behind, so the lag is zero.
  return Math.max(0, latestEventOccurredAtMs - latestSummarizedOccurredAtMs);
}
