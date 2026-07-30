/**
 * Legacy `event_log` type strings. The engine derives its own from the pipeline
 * name and the event key, so nothing emits these any more — they are the wire
 * identifiers of rows already committed, which the blob read path still has to
 * recognise while they remain within retention.
 */
export const SPAN_RECEIVED_EVENT_TYPE = "lw.obs.trace.span_received" as const;
export const SPAN_RECEIVED_EVENT_VERSION_LATEST = "2025-12-14" as const;

/**
 * Retired with the `recordLog` command: canonical `log_records` is the only log
 * write path now, and a trace's log contribution arrives as `logContributed`.
 */
export const LOG_RECORD_RECEIVED_EVENT_TYPE =
  "lw.obs.trace.log_record_received" as const;
export const LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST = "2026-03-08" as const;

export const ANNOTATION_ADDED_EVENT_TYPE =
  "lw.obs.trace.annotation_added" as const;
export const ANNOTATION_ADDED_EVENT_VERSION_LATEST = "2026-03-25" as const;

/** Schema-snapshot version stamped on a `trace_summaries` row. */
export const TRACE_SUMMARY_PROJECTION_VERSION_LATEST = "2026-05-07" as const;
