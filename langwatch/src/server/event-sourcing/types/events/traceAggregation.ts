/**
 * Trace aggregation event types.
 * Types are inferred from Zod schemas for validation and type safety.
 */
export type {
  TraceAggregationEventMetadata,
  TraceAggregationStartedEventData,
  TraceAggregationCompletedEventData,
  TraceAggregationCancelledEventData,
  TraceAggregationStartedEvent,
  TraceAggregationCompletedEvent,
  TraceAggregationCancelledEvent,
  TraceAggregationEvent,
} from "../../schemas/events/traceAggregation.schema";

import type {
  TraceAggregationEvent,
  TraceAggregationStartedEvent,
  TraceAggregationCompletedEvent,
  TraceAggregationCancelledEvent,
} from "../../schemas/events/traceAggregation.schema";

/**
 * Type guard for TraceAggregationStartedEvent.
 */
export function isTraceAggregationStartedEvent(
  event: TraceAggregationEvent,
): event is TraceAggregationStartedEvent {
  return event.type === "lw.obs.trace_aggregation.started";
}

/**
 * Type guard for TraceAggregationCompletedEvent.
 */
export function isTraceAggregationCompletedEvent(
  event: TraceAggregationEvent,
): event is TraceAggregationCompletedEvent {
  return event.type === "lw.obs.trace_aggregation.completed";
}

/**
 * Type guard for TraceAggregationCancelledEvent.
 */
export function isTraceAggregationCancelledEvent(
  event: TraceAggregationEvent,
): event is TraceAggregationCancelledEvent {
  return event.type === "lw.obs.trace_aggregation.cancelled";
}
