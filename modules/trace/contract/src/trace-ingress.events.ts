import { z } from "zod";

import { piiRedactionLevelSchema } from "./trace-ingress.commands.ts";
import { SPAN_RECEIVED_EVENT_TYPE } from "./trace-ingress.constants.ts";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./trace.otlp.ts";

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

export const spanReceivedEventMetadataSchema = z
  .object({
    processingTraceparent: z.string().optional(),
    spanId: z.string(),
    traceId: z.string(),
  })
  .passthrough();

export const spanReceivedEventDataSchema = z.object({
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema,
});

export const spanReceivedEventSchema = z.object({
  ...traceIngressEventEnvelopeSchema.shape,
  type: z.literal(SPAN_RECEIVED_EVENT_TYPE),
  data: spanReceivedEventDataSchema,
  metadata: spanReceivedEventMetadataSchema,
});

export type SpanReceivedEventMetadata = z.infer<typeof spanReceivedEventMetadataSchema>;
export type SpanReceivedEventData = z.infer<typeof spanReceivedEventDataSchema>;
export type SpanReceivedEvent = z.infer<typeof spanReceivedEventSchema>;

export function isSpanReceivedEvent<Event extends { type: string }>(
  event: Event,
): event is Event & SpanReceivedEvent {
  return event.type === SPAN_RECEIVED_EVENT_TYPE;
}
