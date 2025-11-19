import { z } from "zod";
import { EventSchema } from "../../library/schemas";
import type { TenantId } from "../../library";

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
 * Zod schema for TraceAggregationStartedEventData.
 */
export const traceAggregationStartedEventDataSchema = z.object({
  traceId: z.string(),
}) satisfies z.ZodType<{
  traceId: string;
}>;

/**
 * Zod schema for TraceAggregationCompletedEventData.
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
}) satisfies z.ZodType<{
  traceId: string;
  spanIds: string[];
  totalSpans: number;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  durationMs: number;
  serviceNames: string[];
  rootSpanId: string | null;
}>;

/**
 * Zod schema for TraceAggregationCancelledEventData.
 */
export const traceAggregationCancelledEventDataSchema = z.object({
  traceId: z.string(),
  reason: z.string().optional(),
}) satisfies z.ZodType<{
  traceId: string;
  reason?: string;
}>;

/**
 * Zod schema for TraceAggregationStartedEvent.
 */
export const traceAggregationStartedEventSchema = EventSchema.extend({
  type: z.literal("lw.obs.trace_aggregation.started"),
  data: traceAggregationStartedEventDataSchema,
  metadata: traceAggregationEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: "lw.obs.trace_aggregation.started";
  data: z.infer<typeof traceAggregationStartedEventDataSchema>;
  metadata: z.infer<typeof traceAggregationEventMetadataSchema>;
}>;

/**
 * Zod schema for TraceAggregationCompletedEvent.
 */
export const traceAggregationCompletedEventSchema = EventSchema.extend({
  type: z.literal("lw.obs.trace_aggregation.completed"),
  data: traceAggregationCompletedEventDataSchema,
  metadata: traceAggregationEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: "lw.obs.trace_aggregation.completed";
  data: z.infer<typeof traceAggregationCompletedEventDataSchema>;
  metadata: z.infer<typeof traceAggregationEventMetadataSchema>;
}>;

/**
 * Zod schema for TraceAggregationCancelledEvent.
 */
export const traceAggregationCancelledEventSchema = EventSchema.extend({
  type: z.literal("lw.obs.trace_aggregation.cancelled"),
  data: traceAggregationCancelledEventDataSchema,
  metadata: traceAggregationEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: "lw.obs.trace_aggregation.cancelled";
  data: z.infer<typeof traceAggregationCancelledEventDataSchema>;
  metadata: z.infer<typeof traceAggregationEventMetadataSchema>;
}>;

/**
 * Types inferred from Zod schemas.
 * Note: tenantId is converted from string to TenantId for compatibility with Event interface.
 */
export type TraceAggregationEventMetadata = z.infer<
  typeof traceAggregationEventMetadataSchema
>;
export type TraceAggregationStartedEventData = z.infer<
  typeof traceAggregationStartedEventDataSchema
>;
export type TraceAggregationCompletedEventData = z.infer<
  typeof traceAggregationCompletedEventDataSchema
>;
export type TraceAggregationCancelledEventData = z.infer<
  typeof traceAggregationCancelledEventDataSchema
>;
export type TraceAggregationStartedEvent = Omit<
  z.infer<typeof traceAggregationStartedEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};
export type TraceAggregationCompletedEvent = Omit<
  z.infer<typeof traceAggregationCompletedEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};
export type TraceAggregationCancelledEvent = Omit<
  z.infer<typeof traceAggregationCancelledEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};

/**
 * Union of all trace aggregation event types.
 */
export type TraceAggregationEvent =
  | TraceAggregationStartedEvent
  | TraceAggregationCompletedEvent
  | TraceAggregationCancelledEvent;
