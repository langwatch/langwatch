export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;
export const SPAN_RECEIVED_EVENT_VERSION_LATEST = "2025-12-14" as const;

export const SPAN_RECEIVED_EVENT_VERSIONS = [
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
] as const;

/**
 * The claim-check twin of `span_received` (ADR-069): staged onto a
 * subscriber's queue in place of the full event, carrying only the span's
 * identity — the payload stays in its canonical store and the handler reads
 * it back from there.
 *
 * This is a plain versioned JOB PAYLOAD, not an event: it exists only between
 * the routing seam and the subscriber that opted into it and is NEVER
 * appended to the event log — which is why it appears in no event-type
 * registry (TRACE_PROCESSING_EVENT_TYPES or otherwise). The durable event
 * stays `span_received`.
 *
 * The versions array is load-bearing: a consumer parses a reference by
 * version, and a version it does not know fails loudly into the queue's
 * retry rather than half-parsing. Bump the date and append here whenever the
 * reference's shape — or the contract of the store it resolves through —
 * changes incompatibly.
 */
export const SPAN_REFERENCED_PAYLOAD_TYPE =
  "lw.obs.trace.span_referenced" as const;
export const SPAN_REFERENCED_PAYLOAD_VERSION_LATEST = "2026-07-24" as const;

export const SPAN_REFERENCED_PAYLOAD_VERSIONS = [
  SPAN_REFERENCED_PAYLOAD_VERSION_LATEST,
] as const;

export const TOPIC_ASSIGNED_EVENT_TYPE = "lw.obs.trace.topic_assigned" as const;
export const TOPIC_ASSIGNED_EVENT_VERSION_LATEST = "2025-02-01" as const;

export const TOPIC_ASSIGNED_EVENT_VERSIONS = [
  TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
] as const;

/**
 * Trace-fold contribution event for a received log record. No live minter
 * since the `recordLog` command was retired (canonical `log_records` is now the
 * only log write path) — kept so historical `event_log` replays of the trace
 * folds still reproduce pre-cutover log contributions.
 */
export const LOG_RECORD_RECEIVED_EVENT_TYPE =
  "lw.obs.trace.log_record_received" as const;
export const LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST = "2026-03-08" as const;

export const LOG_RECORD_RECEIVED_EVENT_VERSIONS = [
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
] as const;

export const LOG_CONTRIBUTED_EVENT_TYPE =
  "lw.obs.trace.log_contributed" as const;
export const LOG_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-17" as const;

export const METRIC_DATA_POINT_CORRELATED_EVENT_TYPE =
  "lw.obs.trace.metric_data_point_correlated" as const;
export const METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST =
  "2026-07-15" as const;

/**
 * How many metric exemplars correlate to a trace — NOT how many metric data
 * points its metrics produced. Trace folds only ever see the trace-scoped
 * correlation events; canonical data points are a separate pipeline. The
 * legacy `metric_record_count` key it replaces counted folded metric records,
 * which no longer exist.
 */
export const METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE =
  "langwatch.reserved.metric_exemplar_correlation_count" as const;

export const ORIGIN_RESOLVED_EVENT_TYPE =
  "lw.obs.trace.origin_resolved" as const;
export const ORIGIN_RESOLVED_EVENT_VERSION_LATEST = "2026-03-13" as const;

export const ORIGIN_RESOLVED_EVENT_VERSIONS = [
  ORIGIN_RESOLVED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATION_ADDED_EVENT_TYPE =
  "lw.obs.trace.annotation_added" as const;
export const ANNOTATION_ADDED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_ADDED_EVENT_VERSIONS = [
  ANNOTATION_ADDED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATION_REMOVED_EVENT_TYPE =
  "lw.obs.trace.annotation_removed" as const;
export const ANNOTATION_REMOVED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_REMOVED_EVENT_VERSIONS = [
  ANNOTATION_REMOVED_EVENT_VERSION_LATEST,
] as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_TYPE =
  "lw.obs.trace.annotations_bulk_synced" as const;
export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST =
  "2026-03-25" as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS = [
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_NAME_CHANGED_EVENT_TYPE =
  "lw.obs.trace.trace_name_changed" as const;
export const TRACE_NAME_CHANGED_EVENT_VERSION_LATEST = "2026-05-07" as const;

export const TRACE_NAME_CHANGED_EVENT_VERSIONS = [
  TRACE_NAME_CHANGED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_PROCESSING_EVENT_TYPES = [
  SPAN_RECEIVED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_CONTRIBUTED_EVENT_TYPE,
  METRIC_DATA_POINT_CORRELATED_EVENT_TYPE,
  ORIGIN_RESOLVED_EVENT_TYPE,
  ANNOTATION_ADDED_EVENT_TYPE,
  ANNOTATION_REMOVED_EVENT_TYPE,
  ANNOTATIONS_BULK_SYNCED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_TYPE,
] as const;

export type TraceProcessingEventType =
  (typeof TRACE_PROCESSING_EVENT_TYPES)[number];

export const RECORD_SPAN_COMMAND_TYPE = "lw.obs.trace.record_span" as const;
export const ASSIGN_TOPIC_COMMAND_TYPE = "lw.obs.trace.assign_topic" as const;
export const RECORD_LOG_CONTRIBUTION_COMMAND_TYPE =
  "lw.obs.trace.record_log_contribution" as const;
export const RECORD_METRIC_CORRELATION_COMMAND_TYPE =
  "lw.obs.trace.record_metric_correlation" as const;
export const RESOLVE_ORIGIN_COMMAND_TYPE =
  "lw.obs.trace.resolve_origin" as const;
export const ADD_ANNOTATION_COMMAND_TYPE =
  "lw.obs.trace.add_annotation" as const;
export const REMOVE_ANNOTATION_COMMAND_TYPE =
  "lw.obs.trace.remove_annotation" as const;
export const BULK_SYNC_ANNOTATIONS_COMMAND_TYPE =
  "lw.obs.trace.bulk_sync_annotations" as const;
export const CHANGE_TRACE_NAME_COMMAND_TYPE =
  "lw.obs.trace.change_trace_name" as const;

export const TRACE_PROCESSING_COMMAND_TYPES = [
  RECORD_SPAN_COMMAND_TYPE,
  ASSIGN_TOPIC_COMMAND_TYPE,
  RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
  RECORD_METRIC_CORRELATION_COMMAND_TYPE,
  RESOLVE_ORIGIN_COMMAND_TYPE,
  ADD_ANNOTATION_COMMAND_TYPE,
  REMOVE_ANNOTATION_COMMAND_TYPE,
  BULK_SYNC_ANNOTATIONS_COMMAND_TYPE,
  CHANGE_TRACE_NAME_COMMAND_TYPE,
] as const;

/**
 * Domain rules for the user-editable trace name. These mirror the schema
 * literals in `events.ts` so the UI, the command, and the projection all
 * read the same numbers.
 */
export const TRACE_NAME_MIN_LENGTH = 1;
export const TRACE_NAME_MAX_LENGTH = 200;

export type TraceProcessingCommandType =
  (typeof TRACE_PROCESSING_COMMAND_TYPES)[number];

/**
 * The stamp immediately before the storage-anchor split - DECODED, not refused.
 *
 * On a pre-split row `trace_summaries.OccurredAt` is `min(span start)`, which is
 * simultaneously:
 *
 *   - a VALID ANCHOR - it is the value the row was actually partitioned and
 *     TTL'd on, so adopting it moves nothing; and
 *   - the CORRECT BASELINE - it is exactly what `EarliestSpanStartMs` was split
 *     out to carry.
 *
 * So the repository reads both fields off that one column and the row heals in
 * place on its next ordinary write: no refold, no re-anchoring, no backfill. A
 * log-only pre-split row carries 0, which is the right answer twice over - no
 * span has been folded, and an unusable anchor lets the next contribution freeze
 * a real one, which is the `196952` escape ADR-087 exists to perform.
 *
 * Why the stamp had to move at all: once BOTH shapes exist,
 * `EarliestSpanStartMs = 0` means either "pre-split row, baseline lives in
 * OccurredAt" or "post-split log-only trace, baseline genuinely 0 and OccurredAt
 * is an ACCEPT time". Reading the second as the first hands `SpanTimingService` a
 * log-shaped time as a span start and inflates the trace's duration by the whole
 * ingest lag. The version is what tells them apart.
 *
 * Rows older than this stamp (`2026-04-23`) took the same OccurredAt meaning, so
 * the decoder's single "not the latest stamp" branch is correct for them too.
 */
export const TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR =
  "2026-05-07" as const;

/**
 * Schema-snapshot version (calendar date). Bump when the trace-summary fold's
 * derivation rules or row shape change so older versions can be told apart.
 *
 * 2026-08-06 - the storage-anchor split (ADR-087, migration 00072). BOTH halves
 * of what this stamp records changed at once: the DERIVATION (`OccurredAt` is now
 * the frozen first-observed business time rather than the running min of span
 * starts) and the ROW SHAPE (`EarliestSpanStartMs` carries the span timing
 * baseline that `OccurredAt` used to double as).
 *
 * This is NOT a refold trigger - see
 * {@link TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR}.
 */
export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2026-08-06" as const;

/**
 * Whether a stored row was written at or after the storage-anchor split
 * (ADR-087, migration 00072) - that is, whether its `OccurredAt` is the frozen
 * anchor and its span timing baseline lives in `EarliestSpanStartMs`.
 *
 * Gated on the PRE-split stamp rather than on the latest one. An equality
 * against the latest stamp is correct only until the next version bump, at
 * which point every already-anchored row reclassifies as legacy and the
 * decoders start reporting the storage anchor as the trace's start - the exact
 * inflation the split was made to prevent. Stamps are calendar dates, so
 * lexicographic order is chronological, and an absent stamp sorts below every
 * real one and stays on the legacy path, which is what an unstamped row means.
 *
 * Same shape as the `Version < TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT`
 * predicate the analytics fold already gates on.
 */
export function isStorageAnchoredVersion(version: string | undefined): boolean {
  return (version ?? "") > TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR;
}

/** Reactors skip traces older than this threshold to avoid re-processing during resyncs. */
export const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export const TRACE_SUMMARY_PROJECTION_VERSIONS = [
  "2026-04-23",
  TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
] as const;

/**
 * Append-coalescing bound for an INLINE recordSpan (ADR-066 pillar 2). A trace's
 * spans share one queue group (or one of its shards), so a busy trace appends
 * one tiny event_log insert per span; folding the group's queued spans into a
 * single multi-row insert keeps the producer off the per-item write path.
 *
 * Lower than the log/metric record bounds on purpose. An inline span is capped
 * at COMMAND_INLINE_THRESHOLD (256 KB) — an order of magnitude fatter than a log
 * record — so the drain's byte budget is what genuinely bounds a span batch, and
 * this count only has to stop a burst of small spans from growing unboundedly.
 * A spooled span is excluded from coalescing entirely; see the resolver in
 * pipeline.ts for why.
 */
export const RECORD_SPAN_COALESCE_MAX_BATCH = 64;
