import { z } from "zod";
import {
  SPAN_STORAGE_COMMAND_TYPES,
  STORE_SPAN_COMMAND_TYPE,
} from "./typeIdentifiers";

export type { SpanStorageCommandType } from "./typeIdentifiers";
export {
  SPAN_STORAGE_COMMAND_TYPES,
  STORE_SPAN_COMMAND_TYPE,
} from "./typeIdentifiers";

/**
 * Zod schema for OpenTelemetry AttributeValue.
 * AttributeValue can be: string, number, boolean, or arrays of these primitives.
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
 */
const attributesSchema = z.record(z.string(), attributeValueSchema);

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
  kind: z.number(),
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
 * Omits id and tenantId since they are handled separately.
 */
const spanDataForCommandSchema = spanDataSchema.omit({
  id: true,
  tenantId: true,
});

/**
 * Zod schema for StoreSpanCommandData.
 */
export const storeSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  spanData: spanDataForCommandSchema,
  collectedAtUnixMs: z.number(),
});

/**
 * Type inferred from the spanDataSchema Zod schema.
 */
export type SpanData = z.infer<typeof spanDataSchema>;

/**
 * Type inferred from the storeSpanCommandDataSchema Zod schema.
 */
export type StoreSpanCommandData = z.infer<typeof storeSpanCommandDataSchema>;

