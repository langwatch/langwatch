import { z } from "zod";
import type { TenantId } from "../../../library";
import { EventSchema } from "../../../library/domain/types";
import { spanDataSchema } from "./commands";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  TRACE_PROCESSING_EVENT_TYPES,
} from "./typeIdentifiers";

export type { TraceProcessingEventType } from "./typeIdentifiers";
export {
  SPAN_RECEIVED_EVENT_TYPE,
  TRACE_PROCESSING_EVENT_TYPES,
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
 * Zod schema for SpanReceivedEventMetadata.
 * Extends EventMetadataBase with span-specific metadata fields.
 */
export const spanReceivedEventMetadataSchema = eventMetadataBaseSchema.extend({
  collectedAtUnixMs: z.number(),
  spanId: z.string(),
  commandId: z.string().optional(),
}) satisfies z.ZodType<{
  processingTraceparent?: string;
  collectedAtUnixMs: number;
  spanId: string;
  commandId?: string;
  [key: string]: unknown;
}>;

/**
 * Zod schema for SpanReceivedEventData.
 * Contains the full span data for replay capability.
 */
export const spanReceivedEventDataSchema = z.object({
  spanData: spanDataSchema,
  collectedAtUnixMs: z.number(),
}) satisfies z.ZodType<{
  spanData: z.infer<typeof spanDataSchema>;
  collectedAtUnixMs: number;
}>;

/**
 * Zod schema for SpanReceivedEvent.
 * Full event schema combining EventSchema with span-specific data and metadata.
 */
export const spanReceivedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_RECEIVED_EVENT_TYPE),
  data: spanReceivedEventDataSchema,
  metadata: spanReceivedEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: typeof SPAN_RECEIVED_EVENT_TYPE;
  data: z.infer<typeof spanReceivedEventDataSchema>;
  metadata: z.infer<typeof spanReceivedEventMetadataSchema>;
}>;

/**
 * Types inferred from Zod schemas.
 * Note: tenantId is converted from string to TenantId for compatibility with Event interface.
 */
export type SpanReceivedEventMetadata = z.infer<
  typeof spanReceivedEventMetadataSchema
>;
export type SpanReceivedEventData = z.infer<typeof spanReceivedEventDataSchema>;
export type SpanReceivedEvent = Omit<
  z.infer<typeof spanReceivedEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};

/**
 * Type guard for SpanReceivedEvent.
 */
export function isSpanReceivedEvent(
  event: TraceProcessingEvent,
): event is SpanReceivedEvent {
  return event.type === SPAN_RECEIVED_EVENT_TYPE;
}

/**
 * Union of all trace processing event types.
 */
export type TraceProcessingEvent = SpanReceivedEvent;
