import { z } from "zod";
import { defineAggregate } from "@langwatch/event-sourcing";
import {
  annotationRefSchema,
  annotationsBulkSyncSchema,
  canonicalSpanSchema,
  isValidMetricCorrelation,
  logContributionSchema,
  metricCorrelationSchema,
  originResolutionSchema,
  topicAssignmentSchema,
  traceNameChangeSchema,
} from "./schema";

/**
 * The `trace` aggregate (ADR-105). `lw.obs.trace.log_record_received` is
 * retired — nothing emits it — and `span_referenced` was never a real event,
 * only a claim-check twin staged at the dispatch seam (ADR-100 §5).
 */
const inertTraceStateSchema = z.object({ lastEventType: z.string().nullable() });
type InertTraceState = z.infer<typeof inertTraceStateSchema>;

export const trace = defineAggregate("trace")
  .state(inertTraceStateSchema, () => ({ lastEventType: null }))
  .events({
    /**
     * A canonicalized span arrived. OTLP normalization, PII redaction,
     * cost/token enrichment and attribute capping all ran upstream, in
     * `canonicalizeSpan.ts`, never in the command.
     */
    spanReceived: {
      data: canonicalSpanSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "spanReceived" }),
    },
    topicAssigned: {
      data: topicAssignmentSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "topicAssigned" }),
    },
    originResolved: {
      data: originResolutionSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "originResolved" }),
    },
    annotationAdded: {
      data: annotationRefSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "annotationAdded" }),
    },
    annotationRemoved: {
      data: annotationRefSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "annotationRemoved" }),
    },
    annotationsBulkSynced: {
      data: annotationsBulkSyncSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "annotationsBulkSynced" }),
    },
    traceNameChanged: {
      data: traceNameChangeSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "traceNameChanged" }),
    },
    /** Bridged from `log-processing`: keys differ, so it crosses via a
     * command bridge, never a direct subscription (ADR-098 decision 9). */
    logContributed: {
      data: logContributionSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "logContributed" }),
    },
    /** Bridged from `metric-processing` for the same reason (`metric`'s
     * aggregate id is the point's own content hash). */
    metricDataPointCorrelated: {
      data: metricCorrelationSchema,
      apply: (state: InertTraceState) => ({ ...state, lastEventType: "metricDataPointCorrelated" }),
    },
  })
  .commands({
    /** `input` is already the canonicalized span — see the module docblock. */
    recordSpan: {
      input: canonicalSpanSchema,
      handle: (_state, input, events) => [events.spanReceived(input)],
    },
    assignTopic: {
      input: topicAssignmentSchema,
      handle: (_state, input, events) => [events.topicAssigned(input)],
    },
    resolveOrigin: {
      input: originResolutionSchema,
      handle: (_state, input, events) => [events.originResolved(input)],
    },
    addAnnotation: {
      input: annotationRefSchema,
      handle: (_state, input, events) => [events.annotationAdded(input)],
    },
    removeAnnotation: {
      input: annotationRefSchema,
      handle: (_state, input, events) => [events.annotationRemoved(input)],
    },
    bulkSyncAnnotations: {
      input: annotationsBulkSyncSchema,
      handle: (_state, input, events) => [events.annotationsBulkSynced(input)],
    },
    changeTraceName: {
      input: traceNameChangeSchema,
      handle: (_state, input, events) => [events.traceNameChanged(input)],
    },
    recordLogContribution: {
      input: logContributionSchema,
      handle: (_state, input, events) => [events.logContributed(input)],
    },
    /**
     * Emits nothing for an all-zero or malformed trace/span id — a common
     * "null" sentinel in tracing systems, not a real correlation.
     */
    recordMetricCorrelation: {
      input: metricCorrelationSchema,
      handle: (_state, input, events) =>
        isValidMetricCorrelation(input) ? [events.metricDataPointCorrelated(input)] : [],
    },
  })
  .build();

/** The aggregate id every command/event above is dispatched under. */
export function traceAggregateId(data: { traceId: string }): string {
  return data.traceId;
}
