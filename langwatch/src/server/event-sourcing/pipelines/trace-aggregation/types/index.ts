export type {
  TraceAggregationEvent,
  TraceAggregationStartedEvent,
  TraceAggregationCompletedEvent,
  TraceAggregationCancelledEvent,
  TraceAggregationStartedEventData,
  TraceAggregationCompletedEventData,
  TraceAggregationCancelledEventData,
  TraceAggregationEventMetadata,
} from "../../../types/events/traceAggregation";
export {
  isTraceAggregationStartedEvent,
  isTraceAggregationCompletedEvent,
  isTraceAggregationCancelledEvent,
} from "../../../types/events/traceAggregation";
export type { TriggerTraceAggregationCommandData } from "./triggerTraceAggregationCommand";
