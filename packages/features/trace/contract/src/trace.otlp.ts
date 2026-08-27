import { z } from "zod";

export const longBitsSchema = z.object({
  low: z.number(),
  high: z.number(),
});

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

export const fixed64Schema = z.union([longBitsSchema, z.string(), z.number()]);

export const bytesSchema = z.instanceof(Uint8Array);

const NUMERIC_KEY = /^\d+$/;

const serializedUint8ArraySchema = z.record(
  z.string().regex(NUMERIC_KEY),
  z.number().int().min(0).max(255),
);

/** Sorts a validated serialized-Uint8Array object by numeric key and returns the byte values. */
function sortedByteValues(obj: Record<string, number>): number[] {
  return Object.entries(obj)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function trySerializedByteValues(value: unknown): number[] | undefined {
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

  const bytes = trySerializedByteValues(value);
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

      const bytes = trySerializedByteValues(value);
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
  values: z.array(anyValueSchema),
});

export const keyValueListSchema: z.ZodType<OtlpKeyValueList> = z.object({
  values: z.array(keyValueSchema),
});

export const resourceSchema = z.object({
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number().optional().nullable(),
  schemaUrl: z.string().optional().nullable(),
});

export const instrumentationScopeSchema = z.object({
  name: z.string(),
  version: z.string().optional().nullable(),
  attributes: z.array(keyValueSchema).optional().nullable(),
  droppedAttributesCount: z.number().optional().nullable(),
});

const STATUS_CODE_SET = {
  0: true,
  1: true,
  2: true,
} as const;

/** OTLP uses numeric span kinds in binary and symbolic names in JSON. */
export const eSpanKindSchema = z.union([
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

export const eStatusCodeSchema = z
  .number()
  .int()
  .refine((v): v is 0 | 1 | 2 => v in STATUS_CODE_SET, {
    message: "Invalid EStatusCode",
  });

export const statusSchema = z.object({
  message: z.string().optional().nullable(),
  code: eStatusCodeSchema.optional().nullable(),
});

export const eventSchema = z.object({
  timeUnixNano: fixed64Schema,
  name: z.string(),
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number().optional().nullable(),
});

export const linkSchema = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().optional().nullable(),
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number().nullable(),
  flags: z.number().optional().nullable(),
});

export const spanSchema = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().nullable().optional(),
  parentSpanId: idSchema.nullable().optional(),
  name: z.string(),
  kind: eSpanKindSchema,
  startTimeUnixNano: fixed64Schema,
  endTimeUnixNano: fixed64Schema,
  attributes: z.array(keyValueSchema),
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

export const scopeSpansSchema = z.object({
  scope: instrumentationScopeSchema.optional(),
  spans: z.array(spanSchema).optional(),
  schemaUrl: z.string().nullable().optional(),
});

export const resourceSpansSchema = z.object({
  resource: resourceSchema.optional(),
  scopeSpans: z.array(scopeSpansSchema),
  schemaUrl: z.string().optional(),
});

export const exportTraceServiceRequestSchema = z.object({
  resourceSpans: z.array(resourceSpansSchema).optional(),
});

export type OtlpSpan = z.infer<typeof spanSchema>;
export type OtlpResource = z.infer<typeof resourceSchema>;
export type OtlpInstrumentationScope = z.infer<typeof instrumentationScopeSchema>;
