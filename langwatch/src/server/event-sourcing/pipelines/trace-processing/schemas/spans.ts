import { z } from "zod";

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

const normalizedSpanKindSchema = z.nativeEnum(NormalizedSpanKind);
const normalizedStatusCodeSchema = z.nativeEnum(NormalizedStatusCode);

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
  kind: normalizedSpanKindSchema,
  resourceAttributes: normalizedAttributesSchema,
  spanAttributes: normalizedAttributesSchema,
  events: z.array(normalizedEventSchema),
  links: z.array(normalizedLinkSchema),
  statusMessage: z.string().nullable(),
  statusCode: normalizedStatusCodeSchema.nullable(),
  instrumentationScope: normalizedInstrumentationScopeSchema,
  droppedAttributesCount: z.literal(0),
  droppedEventsCount: z.literal(0),
  droppedLinksCount: z.literal(0),
});

export type NormalizedEvent = z.infer<typeof normalizedEventSchema>;
export type NormalizedLink = z.infer<typeof normalizedLinkSchema>;
export type NormalizedSpan = z.infer<typeof normalizedSpanSchema>;

export type NormalizedAttributes = z.infer<typeof normalizedAttributesSchema>;

export type NormalizedAttrScalar = z.infer<
  typeof normalizedAttributeScalarSchema
>;
export type NormalizedAttrValue = z.infer<
  typeof normalizedAttributesValueSchema
>;
