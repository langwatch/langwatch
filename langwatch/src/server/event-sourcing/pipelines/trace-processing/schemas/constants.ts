export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;
export const SPAN_RECEIVED_EVENT_VERSION_LATEST = "2025-12-14" as const;

export const SPAN_RECEIVED_EVENT_VERSIONS = [
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
] as const;

/**
 * The claim-check twin of `span_received` (ADR-069): staged onto a
 * subscriber's queue in place of the full event, carrying only the span's
 * identity — the payload stays in its canonical store and the handler reads
 * it back from there. It is never appended to the event log, which is why it
 * is deliberately absent from TRACE_PROCESSING_EVENT_TYPES: it exists only
 * between the routing seam and the subscriber that opted into it.
 *
 * The versions array is load-bearing: a consumer parses a reference by
 * version, and a version it does not know fails loudly into the queue's
 * retry rather than half-parsing. Bump the date and append here whenever the
 * reference's shape — or the contract of the store it resolves through —
 * changes incompatibly.
 */
export const SPAN_REFERENCED_EVENT_TYPE =
  "lw.obs.trace.span_referenced" as const;
export const SPAN_REFERENCED_EVENT_VERSION_LATEST = "2026-07-24" as const;

export const SPAN_REFERENCED_EVENT_VERSIONS = [
  SPAN_REFERENCED_EVENT_VERSION_LATEST,
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

/**
 * Staging-only event types (ADR-069): valid Event brands that travel between
 * the routing seam and a subscriber's queue but are NEVER appended to the
 * event log — which is why they stay out of TRACE_PROCESSING_EVENT_TYPES. They
 * are registered as type identifiers (see typeIdentifiers.ts) solely so a
 * `stage` hook can return them as well-typed Events.
 */
export const TRACE_PROCESSING_STAGING_EVENT_TYPES = [
  SPAN_REFERENCED_EVENT_TYPE,
] as const;

export type TraceProcessingStagingEventType =
  (typeof TRACE_PROCESSING_STAGING_EVENT_TYPES)[number];

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

/** The trace-summary stamp immediately before the storage-anchor split. */
export const TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR =
  "2026-05-07" as const;

/**
 * 2026-08-02: `trace_summaries.OccurredAt` became a frozen storage/TTL anchor;
 * the span timing baseline moved to `EarliestSpanStartMs` (migration 00067).
 */
export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2026-08-02" as const;

/** Reactors skip traces older than this threshold to avoid re-processing during resyncs. */
export const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

export const TRACE_SUMMARY_PROJECTION_VERSIONS = [
  "2026-04-23",
  TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
] as const;
