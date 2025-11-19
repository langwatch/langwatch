import { z } from "zod";
import type {
  LwObsEntitySpanIngestion,
  LwObsEntityTraceAggregation,
} from "./taxonomy";

type SpanIngestionEventPattern = `${LwObsEntitySpanIngestion}.${string}`;
type TraceAggregationEventPattern = `${LwObsEntityTraceAggregation}.${string}`;

const spanIngestionEvent = <T extends SpanIngestionEventPattern>(name: T) =>
  name;
const traceAggregationEvent = <T extends TraceAggregationEventPattern>(
  name: T,
) => name;

export const EVENT_TYPES = [
  spanIngestionEvent("lw.obs.span_ingestion.recorded"),
  traceAggregationEvent("lw.obs.trace_aggregation.started"),
  traceAggregationEvent("lw.obs.trace_aggregation.completed"),
  traceAggregationEvent("lw.obs.trace_aggregation.cancelled"),
] as const;

/**
 * Zod schema for event type identifiers.
 */
export const EventTypeSchema = z.enum(EVENT_TYPES);

export type EventType = z.infer<typeof EventTypeSchema>;
