import { z } from "zod";
import { EventSchema } from "../../library/domain/types";
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
 * Zod schema for SpanIngestionEventMetadata.
 * Extends EventMetadataBase with span-specific metadata fields.
 */
export const spanIngestionEventMetadataSchema = eventMetadataBaseSchema.extend({
  collectedAtUnixMs: z.number().optional(),
  spanId: z.string().optional(),
  commandId: z.string().optional(),
}) satisfies z.ZodType<{
  processingTraceparent?: string;
  collectedAtUnixMs?: number;
  spanId?: string;
  commandId?: string;
  [key: string]: unknown;
}>;

/**
 * Zod schema for SpanIngestionEventData.
 * Lightweight event containing only identifiers.
 */
export const spanIngestionEventDataSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  collectedAtUnixMs: z.number(),
}) satisfies z.ZodType<{
  traceId: string;
  spanId: string;
  collectedAtUnixMs: number;
}>;

/**
 * Event type identifier for span ingestion recorded event.
 */
export const SPAN_INGESTION_RECORDED_EVENT_TYPE = "lw.obs.span_ingestion.recorded" as const;

/**
 * Zod schema for SpanIngestionRecordedEventMetadata.
 * Required metadata fields for recorded events.
 */
export const spanIngestionRecordedEventMetadataSchema =
  spanIngestionEventMetadataSchema.extend({
    spanId: z.string(),
    collectedAtUnixMs: z.number(),
  }) satisfies z.ZodType<{
    processingTraceparent?: string;
    spanId: string;
    collectedAtUnixMs: number;
    commandId?: string;
    [key: string]: unknown;
  }>;

/**
 * Zod schema for SpanIngestionRecordedEvent.
 * Full event schema combining EventSchema with span-specific data and metadata.
 */
export const spanIngestionRecordedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_INGESTION_RECORDED_EVENT_TYPE),
  data: spanIngestionEventDataSchema,
  metadata: spanIngestionRecordedEventMetadataSchema,
}) satisfies z.ZodType<{
  id: string;
  aggregateId: string;
  tenantId: string;
  timestamp: number;
  type: typeof SPAN_INGESTION_RECORDED_EVENT_TYPE;
  data: z.infer<typeof spanIngestionEventDataSchema>;
  metadata: z.infer<typeof spanIngestionRecordedEventMetadataSchema>;
}>;

/**
 * Types inferred from Zod schemas.
 * Note: tenantId is converted from string to TenantId for compatibility with Event interface.
 */
export type SpanIngestionEventMetadata = z.infer<
  typeof spanIngestionEventMetadataSchema
>;
export type SpanIngestionEventData = z.infer<
  typeof spanIngestionEventDataSchema
>;
export type SpanIngestionRecordedEventMetadata = z.infer<
  typeof spanIngestionRecordedEventMetadataSchema
>;
export type SpanIngestionRecordedEvent = Omit<
  z.infer<typeof spanIngestionRecordedEventSchema>,
  "tenantId"
> & {
  tenantId: TenantId;
};

/**
 * Union of all span event types.
 */
export type SpanIngestionEvent = SpanIngestionRecordedEvent;

/**
 * All event type identifiers for span ingestion events.
 */
export const SPAN_INGESTION_EVENT_TYPES = [
  SPAN_INGESTION_RECORDED_EVENT_TYPE,
] as const;

/**
 * Type for span ingestion event type identifiers.
 */
export type SpanIngestionEventType = (typeof SPAN_INGESTION_EVENT_TYPES)[number];
