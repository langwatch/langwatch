import { z } from "zod";
import type { TenantId } from "../../../library";
import { EventSchema } from "../../../library/domain/types";
import { spanDataSchema } from "./commands";
import {
  SPAN_STORAGE_EVENT_TYPES,
  SPAN_STORED_EVENT_TYPE,
} from "./typeIdentifiers";

export type { SpanStorageEventType } from "./typeIdentifiers";
export {
  SPAN_STORAGE_EVENT_TYPES,
  SPAN_STORED_EVENT_TYPE,
} from "./typeIdentifiers";

/**
 * Zod schema for EventMetadataBase.
 */
const eventMetadataBaseSchema = z
  .object({
    processingTraceparent: z.string().optional(),
  })
  .passthrough();

/**
 * Zod schema for SpanStoredEventMetadata.
 */
export const spanStoredEventMetadataSchema = eventMetadataBaseSchema.extend({
  collectedAtUnixMs: z.number(),
  traceId: z.string(),
  commandId: z.string().optional(),
});

/**
 * Zod schema for SpanStoredEventData.
 * Contains the full span data for storage.
 */
export const spanStoredEventDataSchema = z.object({
  spanData: spanDataSchema,
  collectedAtUnixMs: z.number(),
});

/**
 * Zod schema for SpanStoredEvent.
 */
export const spanStoredEventSchema = EventSchema.extend({
  type: z.literal(SPAN_STORED_EVENT_TYPE),
  data: spanStoredEventDataSchema,
  metadata: spanStoredEventMetadataSchema,
});

/**
 * Types inferred from Zod schemas.
 */
export type SpanStoredEventMetadata = z.infer<
  typeof spanStoredEventMetadataSchema
>;
export type SpanStoredEventData = z.infer<typeof spanStoredEventDataSchema>;
export type SpanStoredEvent = Omit<
  z.infer<typeof spanStoredEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};

/**
 * Type guard for SpanStoredEvent.
 */
export function isSpanStoredEvent(
  event: SpanStorageEvent,
): event is SpanStoredEvent {
  return event.type === SPAN_STORED_EVENT_TYPE;
}

/**
 * Union of all span storage event types.
 */
export type SpanStorageEvent = SpanStoredEvent;

