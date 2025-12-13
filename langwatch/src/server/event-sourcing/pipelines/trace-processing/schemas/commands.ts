import { z } from "zod";
import {
  RECORD_SPAN_COMMAND_TYPE,
  TRACE_PROCESSING_COMMAND_TYPES,
} from "./typeIdentifiers";

export type { TraceProcessingCommandType } from "./typeIdentifiers";
export {
  RECORD_SPAN_COMMAND_TYPE,
  TRACE_PROCESSING_COMMAND_TYPES,
} from "./typeIdentifiers";

// Export pure span data schema for use in events
export { pureSpanDataSchema };

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
 * Zod schema for pure span data (user input only, no computed fields).
 * This represents the data as it comes from the user, without any
 * system-generated enrichments. Used in events for proper event sourcing.
 *
 * Computed fields added during processing:
 * - id: Generated unique identifier for the span record
 * - aggregateId: Set to traceId for event stream aggregation
 * - tenantId: Derived from command/event context
 */
const pureSpanDataSchema = spanDataSchema.omit({
  id: true,
  aggregateId: true,
  tenantId: true,
});

/**
 * Zod schema for SpanData in command payloads.
 * Uses pure span data schema.
 */
const spanDataForCommandSchema = pureSpanDataSchema;

/**
 * Zod schema for RecordSpanCommandData.
 * Matches the RecordSpanCommandData interface structure.
 * The spanData in commands omits id and tenantId (handled separately).
 */
export const recordSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  spanData: spanDataForCommandSchema,
  collectedAtUnixMs: z.number(),
}) satisfies z.ZodType<{
  tenantId: string;
  spanData: z.infer<typeof spanDataForCommandSchema>;
  collectedAtUnixMs: number;
}>;

/**
 * Type inferred from the pureSpanDataSchema Zod schema.
 * Represents span data as it comes from the user, without computed fields.
 */
export type PureSpanData = z.infer<typeof pureSpanDataSchema>;

/**
 * Type inferred from the spanDataSchema Zod schema.
 * Represents enriched span data with computed fields for internal processing.
 */
export type SpanData = z.infer<typeof spanDataSchema>;

/**
 * Type inferred from the recordSpanCommandDataSchema Zod schema.
 */
export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;
