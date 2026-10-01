import {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_MAX_PAST_MS,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  SPAN_RECEIVED_EVENT_VERSIONS,
} from "./trace-ingress.constants.ts";

export {
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_MAX_PAST_MS,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
  SPAN_RECEIVED_EVENT_VERSIONS,
};

export const SPAN_RECORDED_EVENT_TYPE = "lw.trace.span_recorded" as const;
export const SPAN_RECORDED_EVENT_VERSION_LATEST = "2026-08-27" as const;

export const SPAN_RECORDED_EVENT_VERSIONS = [SPAN_RECORDED_EVENT_VERSION_LATEST] as const;

/**
 * Claim-check twin of span_received (ADR-069): job payload (not event),
 * staging span identity only. Versions array is load-bearing for detecting
 * incompatible changes; consumers fail loudly on unknown versions.
 */
export const SPAN_REFERENCED_PAYLOAD_TYPE = "lw.obs.trace.span_referenced" as const;
export const SPAN_REFERENCED_PAYLOAD_VERSION_LATEST = "2026-07-24" as const;

export const SPAN_REFERENCED_PAYLOAD_VERSIONS = [SPAN_REFERENCED_PAYLOAD_VERSION_LATEST] as const;

export const TOPIC_ASSIGNED_EVENT_TYPE = "lw.obs.trace.topic_assigned" as const;
export const TOPIC_ASSIGNED_EVENT_VERSION_LATEST = "2025-02-01" as const;

export const TOPIC_ASSIGNED_EVENT_VERSIONS = [TOPIC_ASSIGNED_EVENT_VERSION_LATEST] as const;

/**
 * Trace-fold contribution event for a received log record. No live minter
 * since `recordLog` was retired — kept so historical `event_log` replays
 * still reproduce pre-cutover log contributions.
 */
export const LOG_RECORD_RECEIVED_EVENT_TYPE = "lw.obs.trace.log_record_received" as const;
export const LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST = "2026-03-08" as const;

export const LOG_RECORD_RECEIVED_EVENT_VERSIONS = [
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
] as const;

export const LOG_CONTRIBUTED_EVENT_TYPE = "lw.obs.trace.log_contributed" as const;
export const LOG_CONTRIBUTED_EVENT_VERSION_LATEST = "2026-07-17" as const;

export const METRIC_DATA_POINT_CORRELATED_EVENT_TYPE =
  "lw.obs.trace.metric_data_point_correlated" as const;
export const METRIC_DATA_POINT_CORRELATED_EVENT_VERSION_LATEST = "2026-07-15" as const;

/**
 * How many metric exemplars correlate to a trace — NOT how many metric data
 * points its metrics produced; trace folds only see the trace-scoped
 * correlation events. Replaces the legacy `metric_record_count` key.
 */
export const METRIC_EXEMPLAR_CORRELATION_COUNT_ATTRIBUTE =
  "langwatch.reserved.metric_exemplar_correlation_count" as const;

export const ORIGIN_RESOLVED_EVENT_TYPE = "lw.obs.trace.origin_resolved" as const;
export const ORIGIN_RESOLVED_EVENT_VERSION_LATEST = "2026-03-13" as const;

export const ORIGIN_RESOLVED_EVENT_VERSIONS = [ORIGIN_RESOLVED_EVENT_VERSION_LATEST] as const;

export const ANNOTATION_ADDED_EVENT_TYPE = "lw.obs.trace.annotation_added" as const;
export const ANNOTATION_ADDED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_ADDED_EVENT_VERSIONS = [ANNOTATION_ADDED_EVENT_VERSION_LATEST] as const;

export const ANNOTATION_REMOVED_EVENT_TYPE = "lw.obs.trace.annotation_removed" as const;
export const ANNOTATION_REMOVED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATION_REMOVED_EVENT_VERSIONS = [ANNOTATION_REMOVED_EVENT_VERSION_LATEST] as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_TYPE = "lw.obs.trace.annotations_bulk_synced" as const;
export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST = "2026-03-25" as const;

export const ANNOTATIONS_BULK_SYNCED_EVENT_VERSIONS = [
  ANNOTATIONS_BULK_SYNCED_EVENT_VERSION_LATEST,
] as const;

export const TRACE_NAME_CHANGED_EVENT_TYPE = "lw.obs.trace.trace_name_changed" as const;
export const TRACE_NAME_CHANGED_EVENT_VERSION_LATEST = "2026-05-07" as const;

export const TRACE_NAME_CHANGED_EVENT_VERSIONS = [TRACE_NAME_CHANGED_EVENT_VERSION_LATEST] as const;

export const TRACE_PROCESSING_EVENT_TYPES = [
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECORDED_EVENT_TYPE,
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

export type TraceProcessingEventType = (typeof TRACE_PROCESSING_EVENT_TYPES)[number];

export const RECORD_TRACE_SPAN_COMMAND_TYPE = "lw.trace.record_span" as const;
export const ASSIGN_TOPIC_COMMAND_TYPE = "lw.obs.trace.assign_topic" as const;
export const RECORD_LOG_CONTRIBUTION_COMMAND_TYPE = "lw.obs.trace.record_log_contribution" as const;
export const RECORD_METRIC_CORRELATION_COMMAND_TYPE =
  "lw.obs.trace.record_metric_correlation" as const;
export const RESOLVE_ORIGIN_COMMAND_TYPE = "lw.obs.trace.resolve_origin" as const;
export const ADD_ANNOTATION_COMMAND_TYPE = "lw.obs.trace.add_annotation" as const;
export const REMOVE_ANNOTATION_COMMAND_TYPE = "lw.obs.trace.remove_annotation" as const;
export const BULK_SYNC_ANNOTATIONS_COMMAND_TYPE = "lw.obs.trace.bulk_sync_annotations" as const;
export const CHANGE_TRACE_NAME_COMMAND_TYPE = "lw.obs.trace.change_trace_name" as const;

export const TRACE_PROCESSING_COMMAND_TYPES = [
  RECORD_SPAN_COMMAND_TYPE,
  RECORD_TRACE_SPAN_COMMAND_TYPE,
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

export type TraceProcessingCommandType = (typeof TRACE_PROCESSING_COMMAND_TYPES)[number];

/** The stamp immediately before the storage-anchor split (ADR-087). On a pre-split
 * row, OccurredAt is the partition key; readers derive both anchor and span baseline
 * from it, and the row heals on its next write without refold. */
export const TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR = "2026-05-07" as const;

/** Schema-snapshot version (calendar date). Bumped on storage-anchor split
 * (ADR-087): OccurredAt now frozen at first-observed time; span baseline moved
 * to EarliestSpanStartMs. Not a refold trigger. */
export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2026-08-06" as const;

/** Whether a row was written at or after the storage-anchor split (ADR-087).
 * Gated on the pre-split stamp (not latest) to remain valid through future version
 * bumps; lexicographic order = chronological, so missing stamp stays on legacy path. */
export function isStorageAnchoredVersion(version: string | undefined): boolean {
  return (version ?? "") > TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR;
}

/** Subscribers skip traces older than this threshold to avoid re-processing during resyncs. */
export const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/**
 * Span name `/api/track_event` and the tracked-event sync subscriber give
 * synthetic event spans (a thumbs-up, a rating) — not actual execution, so
 * excluded from trace timing calculations.
 */
export const TRACK_EVENT_SPAN_NAME = "langwatch.track_event" as const;

/** Span names that represent synthetic events, not real execution. */
export const SYNTHETIC_TRACE_SPAN_NAMES: ReadonlySet<string> = new Set([TRACK_EVENT_SPAN_NAME]);

export const TRACE_SUMMARY_PROJECTION_VERSIONS = [
  "2026-04-23",
  TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
] as const;

/** Append-coalescing bound for inline recordSpan (ADR-066). Coalesces spans to
 * keep producer off per-item write path; lower than log/metric bounds since spans
 * are capped at 256 KB and drain's byte budget is the real limit. */
export const RECORD_SPAN_COALESCE_MAX_BATCH = 64;

/**
 * Correlation commands share a trace queue group, so coalescing prevents
 * chatty traces from producing one tiny event-log part per item. The drain's
 * 4 MiB byte budget bounds large previews before this count does.
 */
export const TRACE_CORRELATION_COALESCE_MAX_BATCH = 256;
