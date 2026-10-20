import type { Named } from "@langwatch/module";
import { z } from "zod";

const longBitsSchemaDefinition = z.object({
  low: z.number(),
  high: z.number(),
});
export interface LongBitsSchema extends Named<typeof longBitsSchemaDefinition> {}
export const longBitsSchema: LongBitsSchema = longBitsSchemaDefinition;

export type OtlpAnyValue = {
  stringValue?: string | null;
  boolValue?: boolean | string | null;
  intValue?: number | string | { low: number; high: number } | null;
  doubleValue?: number | string | null;
  arrayValue?: OtlpArrayValue | null;
  kvlistValue?: OtlpKeyValueList | null;
  bytesValue?: Uint8Array | null;
};

export type OtlpKeyValue = {
  key: string;
  value: OtlpAnyValue;
};

export type OtlpArrayValue = {
  values: OtlpAnyValue[];
};

export type OtlpKeyValueList = {
  values: OtlpKeyValue[];
};

const fixed64SchemaDefinition = z.union([longBitsSchema, z.string(), z.number()]);
export interface Fixed64Schema extends Named<typeof fixed64SchemaDefinition> {}
export const fixed64Schema: Fixed64Schema = fixed64SchemaDefinition;

export const bytesSchema = z.instanceof(Uint8Array);

const NUMERIC_KEY = /^\d+$/;

const serializedUint8ArraySchema = z.record(
  z.string().regex(NUMERIC_KEY),
  z.number().int().min(0).max(255),
);

/** Sorts a validated serialized-Uint8Array object by numeric key and returns the byte values. */
function sortedByteValues(obj: Record<string, number>): number[] {
  return Object.entries(obj)
    .toSorted(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeSerializedByteValues(value: unknown): number[] | undefined {
  const parsed = serializedUint8ArraySchema.safeParse(value);
  if (!parsed.success) {
    return void 0;
  }

  return sortedByteValues(parsed.data);
}

export const idSchema = z.preprocess((value) => {
  if (value instanceof Uint8Array) {
    return bytesToHex(value);
  }

  const bytes = decodeSerializedByteValues(value);
  return bytes ? bytesToHex(new Uint8Array(bytes)) : value;
}, z.string());

/** OTLP AnyValue accepts its optional fields without enforcing oneof exclusivity. */
export const anyValueSchema: z.ZodType<OtlpAnyValue> = z.object({
  stringValue: z.string().nullable().optional(),
  boolValue: z.union([z.boolean(), z.string()]).nullable().optional(),
  intValue: z.union([z.number(), z.string(), longBitsSchema]).nullable().optional(),
  doubleValue: z.union([z.number(), z.string()]).nullable().optional(),
  arrayValue: z
    .lazy(() => arrayValueSchema)
    .optional()
    .nullable(),
  kvlistValue: z
    .lazy(() => keyValueListSchema)
    .optional()
    .nullable(),
  bytesValue: z
    .preprocess((value) => {
      if (value instanceof Uint8Array) {
        return value;
      }

      const bytes = decodeSerializedByteValues(value);
      return bytes ? new Uint8Array(bytes) : value;
    }, bytesSchema)
    .optional()
    .nullable(),
});

export const keyValueSchema: z.ZodType<OtlpKeyValue> = z.object({
  key: z.string(),
  value: anyValueSchema,
});

export const arrayValueSchema: z.ZodType<OtlpArrayValue> = z.object({
  values: z.array(anyValueSchema).optional().default([]),
});

export const keyValueListSchema: z.ZodType<OtlpKeyValueList> = z.object({
  values: z.array(keyValueSchema).optional().default([]),
});

const resourceSchemaDefinition = z.object({
  attributes: z.array(keyValueSchema).optional().default([]),
  droppedAttributesCount: z.number().optional().nullable(),
  schemaUrl: z.string().optional().nullable(),
});
export interface ResourceSchema extends Named<typeof resourceSchemaDefinition> {}
export const resourceSchema: ResourceSchema = resourceSchemaDefinition;

const instrumentationScopeSchemaDefinition = z.object({
  name: z.string(),
  version: z.string().optional().nullable(),
  attributes: z.array(keyValueSchema).optional().nullable(),
  droppedAttributesCount: z.number().optional().nullable(),
});
export interface InstrumentationScopeSchema extends Named<
  typeof instrumentationScopeSchemaDefinition
> {}
export const instrumentationScopeSchema: InstrumentationScopeSchema =
  instrumentationScopeSchemaDefinition;

const STATUS_CODE_SET = {
  0: true,
  1: true,
  2: true,
} as const;

/** OTLP uses numeric span kinds in binary and symbolic names in JSON. */
const eSpanKindSchemaDefinition = z.union([
  z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  z.enum([
    "SPAN_KIND_UNSPECIFIED",
    "SPAN_KIND_INTERNAL",
    "SPAN_KIND_SERVER",
    "SPAN_KIND_CLIENT",
    "SPAN_KIND_PRODUCER",
    "SPAN_KIND_CONSUMER",
  ]),
]);
export interface ESpanKindSchema extends Named<typeof eSpanKindSchemaDefinition> {}
export const eSpanKindSchema: ESpanKindSchema = eSpanKindSchemaDefinition;

export const eStatusCodeSchema = z
  .number()
  .int()
  .refine((v): v is 0 | 1 | 2 => v in STATUS_CODE_SET, {
    message: "Invalid EStatusCode",
  });

const statusSchemaDefinition = z.object({
  message: z.string().optional().nullable(),
  code: eStatusCodeSchema.optional().nullable(),
});
export interface StatusSchema extends Named<typeof statusSchemaDefinition> {}
export const statusSchema: StatusSchema = statusSchemaDefinition;

// ProtoJSON omits default-valued fields (zero counts, empty lists), so every
// such field must accept absence or spec-compliant OTLP/JSON spans are dropped.
const eventSchemaDefinition = z.object({
  timeUnixNano: fixed64Schema,
  name: z.string(),
  attributes: z.array(keyValueSchema).optional().default([]),
  droppedAttributesCount: z.number().optional().nullable(),
});
export interface EventSchema extends Named<typeof eventSchemaDefinition> {}
export const eventSchema: EventSchema = eventSchemaDefinition;

const linkSchemaDefinition = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().optional().nullable(),
  attributes: z.array(keyValueSchema).optional().default([]),
  droppedAttributesCount: z.number().optional().nullable().default(0),
  flags: z.number().optional().nullable(),
});
export interface LinkSchema extends Named<typeof linkSchemaDefinition> {}
export const linkSchema: LinkSchema = linkSchemaDefinition;

const spanSchemaDefinition = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().nullable().optional(),
  parentSpanId: idSchema.nullable().optional(),
  name: z.string(),
  // Absent in ProtoJSON and null from the protobuf decoder when unset: SPAN_KIND_UNSPECIFIED.
  kind: eSpanKindSchema.nullish().transform((kind) => kind ?? 0),
  startTimeUnixNano: fixed64Schema,
  endTimeUnixNano: fixed64Schema,
  attributes: z.array(keyValueSchema).optional().default([]),
  events: z.array(eventSchema).optional().default([]),
  links: z.array(linkSchema).optional().default([]),
  status: statusSchema
    .nullable()
    .optional()
    .default({ message: null, code: null })
    .transform((v) => v ?? { message: null, code: null }),
  flags: z.number().optional().nullable(),
  droppedAttributesCount: z.number().optional().nullable().default(0),
  droppedEventsCount: z.number().optional().nullable().default(0),
  droppedLinksCount: z.number().optional().nullable().default(0),
});
export interface SpanSchema extends Named<typeof spanSchemaDefinition> {}
export const spanSchema: SpanSchema = spanSchemaDefinition;

const scopeSpansSchemaDefinition = z.object({
  scope: instrumentationScopeSchema.optional(),
  spans: z.array(spanSchema).optional(),
  schemaUrl: z.string().nullable().optional(),
});
export interface ScopeSpansSchema extends Named<typeof scopeSpansSchemaDefinition> {}
export const scopeSpansSchema: ScopeSpansSchema = scopeSpansSchemaDefinition;

const resourceSpansSchemaDefinition = z.object({
  resource: resourceSchema.optional(),
  scopeSpans: z.array(scopeSpansSchema).optional().default([]),
  schemaUrl: z.string().optional(),
});
export interface ResourceSpansSchema extends Named<typeof resourceSpansSchemaDefinition> {}
export const resourceSpansSchema: ResourceSpansSchema = resourceSpansSchemaDefinition;

const exportTraceServiceRequestSchemaDefinition = z.object({
  resourceSpans: z.array(resourceSpansSchema).optional(),
});
export interface ExportTraceServiceRequestSchema extends Named<
  typeof exportTraceServiceRequestSchemaDefinition
> {}
export const exportTraceServiceRequestSchema: ExportTraceServiceRequestSchema =
  exportTraceServiceRequestSchemaDefinition;

export type OtlpSpan = z.infer<typeof spanSchema>;
export type OtlpResource = z.infer<typeof resourceSchema>;
export type OtlpInstrumentationScope = z.infer<typeof instrumentationScopeSchema>;
