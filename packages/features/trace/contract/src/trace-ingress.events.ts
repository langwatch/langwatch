import { z } from "zod";
import { SPAN_RECEIVED_EVENT_TYPE } from "./trace-ingress.constants";
import { piiRedactionLevelSchema } from "./trace-ingress.commands";
import { traceIngressEventEnvelopeSchema } from "./trace-ingress.event-envelope";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./trace.otlp";

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

export const spanReceivedEventSchema = traceIngressEventEnvelopeSchema.extend({
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
