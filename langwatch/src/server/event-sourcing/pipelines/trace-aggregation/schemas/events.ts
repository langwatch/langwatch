import { z } from "zod";
import type { TenantId } from "../../../library";
import { EventSchema } from "../../../library/domain/types";
import {
  TRACE_AGGREGATION_COMPLETED_EVENT_TYPE,
  TRACE_AGGREGATION_EVENT_TYPES,
} from "./typeIdentifiers";

export type { TraceAggregationEventType } from "./typeIdentifiers";
export {
  TRACE_AGGREGATION_COMPLETED_EVENT_TYPE,
  TRACE_AGGREGATION_EVENT_TYPES,
} from "./typeIdentifiers";

/**
 * Zod schema for EventMetadataBase.
 * Base metadata that all events can have.
 */
const eventMetadataBaseSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough(); // Allow additional properties via index signature

/**
 * Zod schema for TraceAggregationEventMetadata.
 * Extends EventMetadataBase with trace-specific metadata fields.
 */
export const traceAggregationEventMetadataSchema =
  eventMetadataBaseSchema.extend({
    traceId: z.string().optional(),
  }) satisfies z.ZodType<{
    processingTraceparent?: string;
    traceId?: string;
    [key: string]: unknown;
  }>;

/**
 * Zod schema for TraceAggregationCompletedEventData.
 * Contains all computed trace metrics matching the trace_overviews ClickHouse schema.
 */
export const traceAggregationCompletedEventDataSchema = z.object({
  traceId: z.string(),
  spanIds: z.array(z.string()),
  totalSpans: z.number(),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  durationMs: z.number(),
  serviceNames: z.array(z.string()),
  rootSpanId: z.string().nullable(),
  // Computed metrics
  IOSchemaVersion: z.string(),
  ComputedInput: z.string().nullable(),
  ComputedOutput: z.string().nullable(),
  ComputedMetadata: z.record(z.string(), z.string()),
  TimeToFirstTokenMs: z.number().nullable(),
  TimeToLastTokenMs: z.number().nullable(),
  TokensPerSecond: z.number().nullable(),
  ContainsErrorStatus: z.boolean(),
  ContainsOKStatus: z.boolean(),
  Models: z.array(z.string()),
  TopicId: z.string().nullable(),
  SubTopicId: z.string().nullable(),
  TotalPromptTokenCount: z.number().nullable(),
  TotalCompletionTokenCount: z.number().nullable(),
  HasAnnotation: z.boolean().nullable(),
}) satisfies z.ZodType<{
  traceId: string;
  spanIds: string[];
  totalSpans: number;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  serviceNames: string[];
  rootSpanId: string | null;
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string>;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TokensPerSecond: number | null;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  Models: string[];
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
}>;

/**
 * Zod schema for TraceAggregationCompletedEvent.
 */
export const traceAggregationCompletedEventSchema = EventSchema.extend({
  type: z.literal(TRACE_AGGREGATION_COMPLETED_EVENT_TYPE),
  data: traceAggregationCompletedEventDataSchema,
  metadata: traceAggregationEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: typeof TRACE_AGGREGATION_COMPLETED_EVENT_TYPE;
  data: z.infer<typeof traceAggregationCompletedEventDataSchema>;
  metadata: z.infer<typeof traceAggregationEventMetadataSchema>;
}>;

/**
 * Types inferred from Zod schemas.
 * Note: tenantId is converted from string to TenantId for compatibility with Event interface.
 */
export type TraceAggregationEventMetadata = z.infer<
  typeof traceAggregationEventMetadataSchema
>;
export type TraceAggregationCompletedEventData = z.infer<
  typeof traceAggregationCompletedEventDataSchema
>;
export type TraceAggregationCompletedEvent = Omit<
  z.infer<typeof traceAggregationCompletedEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};

/**
 * Union of all trace aggregation event types.
 */
export type TraceAggregationEvent = TraceAggregationCompletedEvent;

/**
 * Type guard function for trace aggregation completed event.
 */
export function isTraceAggregationCompletedEvent(
  event: TraceAggregationEvent,
): event is TraceAggregationCompletedEvent {
  return event.type === TRACE_AGGREGATION_COMPLETED_EVENT_TYPE;
}
