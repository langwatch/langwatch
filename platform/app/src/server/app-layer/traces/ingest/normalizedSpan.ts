import { z } from "zod";

/**
 * The span shape between the OTLP wire and canonicalisation: ids are hex,
 * timestamps are unix ms, and attributes are a flat map. Still pre-command —
 * `CanonicalSpan` (event-sourcing/trace-processing/schema.ts) is what crosses
 * the command boundary.
 */

export enum NormalizedSpanKind {
  UNSPECIFIED = 0,
  INTERNAL = 1,
  SERVER = 2,
  CLIENT = 3,
  PRODUCER = 4,
  CONSUMER = 5,
}

export enum NormalizedStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

const normalizedAttributeScalarSchema = z.union([
  z.string(),
  z.boolean(),
  z.number(),
  z.bigint(),
]);
const normalizedAttributesValueSchema = z.union([
  normalizedAttributeScalarSchema,
  z.array(normalizedAttributeScalarSchema),
]);

const normalizedAttributesSchema = z.record(z.unknown());

const normalizedInstrumentationScopeSchema = z.object({
  name: z.string(),
  version: z.string().nullable(),
});

const normalizedEventSchema = z.object({
  name: z.string(),
  timeUnixMs: z.number(),
  attributes: normalizedAttributesSchema,
});

const normalizedLinkSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  attributes: normalizedAttributesSchema,
});

const normalizedSpanSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  tenantId: z.string(),
  parentSpanId: z.string().nullable(),
  parentTraceId: z.string().nullable(),
  parentIsRemote: z.boolean().nullable(),
  sampled: z.boolean(),
  startTimeUnixMs: z.number(),
  endTimeUnixMs: z.number(),
  durationMs: z.number(),
  name: z.string(),
  kind: z.nativeEnum(NormalizedSpanKind),
  resourceAttributes: normalizedAttributesSchema,
  spanAttributes: normalizedAttributesSchema,
  events: z.array(normalizedEventSchema),
  links: z.array(normalizedLinkSchema),
  statusMessage: z.string().nullable(),
  statusCode: z.nativeEnum(NormalizedStatusCode).nullable(),
  instrumentationScope: normalizedInstrumentationScopeSchema,
  droppedAttributesCount: z.literal(0),
  droppedEventsCount: z.literal(0),
  droppedLinksCount: z.literal(0),
  /** Null when the span carries no costable usage (no tokens, no explicit cost). */
  cost: z.number().nullable(),
  /**
   * The portion of `cost` a flat plan covers rather than billing per token
   * (`langwatch.cost.non_billable`), so `cost - nonBilledCost` is what bills.
   */
  nonBilledCost: z.number().nullable(),
});

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type NormalizedSpan = z.infer<typeof normalizedSpanSchema>;

export type NormalizedAttributes = z.infer<typeof normalizedAttributesSchema>;

export type NormalizedAttrScalar = z.infer<
  typeof normalizedAttributeScalarSchema
>;
export type NormalizedAttrValue = z.infer<
  typeof normalizedAttributesValueSchema
>;
