import { z } from "zod";
import {
  SPAN_INGESTION_RECORD_COMMAND_TYPE,
  SPAN_INGESTION_COMMAND_TYPES,
} from "./typeIdentifiers";

export type { SpanIngestionCommandType } from "./typeIdentifiers";
export {
  SPAN_INGESTION_RECORD_COMMAND_TYPE,
  SPAN_INGESTION_COMMAND_TYPES,
} from "./typeIdentifiers";

/**
 * Zod schema for OpenTelemetry AttributeValue.
 * AttributeValue can be: string, number, boolean, or arrays of these primitives.
 * Note: After filtering, we store clean arrays without null/undefined elements,
 * matching what ClickHouse expects for our storage format.
 */
const attributeValueSchema: z.ZodType<
  string | number | boolean | string[] | number[] | boolean[]
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.array(z.boolean()),
]);

/**
 * Zod schema for Attributes after filtering undefined values.
 * This matches what we actually store - record keys with undefined values are filtered out,
 * and arrays don't contain null/undefined elements.
 * The filtering happens in spanProcessingMapperService.filterUndefinedAttributes().
 */
const attributesSchema = z.record(z.string(), attributeValueSchema);

/**
 * Zod schema for SpanKind enum from OpenTelemetry.
 * SpanKind is a number enum, but we'll accept any number for flexibility.
 */
const spanKindSchema = z.number();

/**
 * Zod schema for span events.
 */
const spanEventSchema = z.object({
  name: z.string(),
  timeUnixMs: z.number(),
  attributes: attributesSchema,
});

/**
 * Zod schema for span links.
 */
const spanLinkSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  traceState: z.string().nullable(),
  attributes: attributesSchema.optional(),
});

/**
 * Zod schema for span status.
 */
const spanStatusSchema = z.object({
  code: z.number(),
  message: z.string().nullable(),
});

/**
 * Zod schema for instrumentation scope.
 */
const instrumentationScopeSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
});

/**
 * Zod schema for SpanData.
 * Matches the SpanData interface structure.
 */
export const spanDataSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  tenantId: z.string(),

  // Span context fields
  traceId: z.string(),
  spanId: z.string(),
  traceFlags: z.number(),
  traceState: z.string().nullable(),
  isRemote: z.boolean(),

  // Parent span context
  parentSpanId: z.string().nullable(),

  // Basic span info
  name: z.string(),
  kind: spanKindSchema,
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),

  // Attributes
  attributes: attributesSchema,

  // Events
  events: z.array(spanEventSchema),

  // Links
  links: z.array(spanLinkSchema),

  // Status
  status: spanStatusSchema,

  // Resource data
  resourceAttributes: attributesSchema.optional(),

  // Instrumentation scope
  instrumentationScope: instrumentationScopeSchema,

  // Additional metadata
  durationMs: z.number(),
  ended: z.boolean(),
  droppedAttributesCount: z.number(),
  droppedEventsCount: z.number(),
  droppedLinksCount: z.number(),
});

/**
 * Zod schema for SpanData in command payloads.
 * Omits id and tenantId since:
 * - id is generated in the repository
 * - tenantId comes from the command level
 */
const spanDataForCommandSchema = spanDataSchema.omit({
  id: true,
  tenantId: true,
});

/**
 * Zod schema for StoreSpanIngestionCommandData.
 * Matches the StoreSpanIngestionCommandData interface structure.
 * The spanData in commands omits id and tenantId (handled separately).
 */
export const storeSpanIngestionCommandDataSchema = z.object({
  tenantId: z.string(),
  spanData: spanDataForCommandSchema,
  collectedAtUnixMs: z.number(),
}) satisfies z.ZodType<{
  tenantId: string;
  spanData: z.infer<typeof spanDataForCommandSchema>;
  collectedAtUnixMs: number;
}>;

/**
 * Type inferred from the spanDataSchema Zod schema.
 */
export type SpanData = z.infer<typeof spanDataSchema>;

/**
 * Type inferred from the storeSpanIngestionCommandDataSchema Zod schema.
 */
export type StoreSpanIngestionCommandData = z.infer<
  typeof storeSpanIngestionCommandDataSchema
>;
