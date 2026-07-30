import {
  annotationRefSchema,
  annotationsBulkSyncSchema,
  canonicalSpanSchema,
  logContributionSchema,
  metricCorrelationSchema,
  originResolutionSchema,
  topicAssignmentSchema,
  traceNameChangeSchema,
} from "./schema";

/** `prefix` is what makes every derived type string byte-equal the ones
 * already in `event_log` (e.g. `lw.obs.trace.span_received`). */
export const TRACE_PIPELINE_NAME = "trace";
export const TRACE_PIPELINE_PREFIX = "lw.obs";

export const traceEvents = {
  spanReceived: canonicalSpanSchema,
  topicAssigned: topicAssignmentSchema,
  originResolved: originResolutionSchema,
  annotationAdded: annotationRefSchema,
  annotationRemoved: annotationRefSchema,
  annotationsBulkSynced: annotationsBulkSyncSchema,
  traceNameChanged: traceNameChangeSchema,
  /** Bridged from `log-processing` (ADR-098 decision 9). */
  logContributed: logContributionSchema,
  /** Bridged from `metric-processing`, whose aggregate id is the point's content hash. */
  metricDataPointCorrelated: metricCorrelationSchema,
} as const;
