import type { Named } from "@langwatch/module";
import { z } from "zod";

import { SPAN_RECEIVED_EVENT_TYPE } from "../../trace.constants.ts";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "../../trace.otlp.ts";
import { piiRedactionLevelSchema } from "./trace-processing.commands.ts";

/** Portable envelope for Trace's durable raw ingress fact. */
const traceIngressEventEnvelopeSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.string().trim().min(1),
  tenantId: z
    .string()
    .trim()
    .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
    .brand<"TenantId">(),
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: z.object({ processingTraceparent: z.string().optional() }).passthrough().optional(),
  idempotencyKey: z.string().optional(),
});

/** Ids optional: the event log keeps only the traceparent, so an event read back carries none. */
const spanReceivedEventMetadataSchemaDefinition = z
  .object({
    processingTraceparent: z.string().optional(),
    spanId: z.string().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();
export interface SpanReceivedEventMetadataSchema extends Named<
  typeof spanReceivedEventMetadataSchemaDefinition
> {}
export const spanReceivedEventMetadataSchema: SpanReceivedEventMetadataSchema =
  spanReceivedEventMetadataSchemaDefinition;

const spanReceivedEventDataSchemaDefinition = z.object({
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});
export interface SpanReceivedEventDataSchema extends Named<
  typeof spanReceivedEventDataSchemaDefinition
> {}
export const spanReceivedEventDataSchema: SpanReceivedEventDataSchema =
  spanReceivedEventDataSchemaDefinition;

const spanReceivedEventSchemaDefinition = z.object({
  ...traceIngressEventEnvelopeSchema.shape,
  type: z.literal(SPAN_RECEIVED_EVENT_TYPE),
  data: spanReceivedEventDataSchema,
  metadata: spanReceivedEventMetadataSchema.optional(),
});
export interface SpanReceivedEventSchema extends Named<typeof spanReceivedEventSchemaDefinition> {}
export const spanReceivedEventSchema: SpanReceivedEventSchema = spanReceivedEventSchemaDefinition;

/** What a metering consumer reads of span_received: its trace and when the span started. */
const spanReceivedMeteringDataSchemaDefinition = z.object({
  span: spanSchema.pick({ traceId: true, startTimeUnixNano: true }),
});
export interface SpanReceivedMeteringDataSchema extends Named<
  typeof spanReceivedMeteringDataSchemaDefinition
> {}
export const spanReceivedMeteringDataSchema: SpanReceivedMeteringDataSchema =
  spanReceivedMeteringDataSchemaDefinition;

export type SpanReceivedEventMetadata = z.infer<typeof spanReceivedEventMetadataSchema>;
export type SpanReceivedEventData = z.infer<typeof spanReceivedEventDataSchema>;
export type SpanReceivedEvent = z.infer<typeof spanReceivedEventSchema>;

export function isSpanReceivedEvent<Event extends { type: string }>(
  event: Event,
): event is Event & SpanReceivedEvent {
  return event.type === SPAN_RECEIVED_EVENT_TYPE;
}
