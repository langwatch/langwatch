import {
  ESpanKind,
  type EStatusCode,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
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

/** Checks whether an object looks like a JSON-serialized Uint8Array ({"0":1,"1":2,...}). */
function isSerializedUint8Array(obj: Record<string, unknown>): obj is Record<string, number> {
  return Object.entries(obj).every(
    ([k, v]) => NUMERIC_KEY.test(k) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255,
  );
}

/** Sorts a validated serialized-Uint8Array object by numeric key and returns the byte values. */
function sortedByteValues(obj: Record<string, number>): number[] {
  return Object.entries(obj)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v);
}

// Normalize Uint8Array / JSON-serialized Uint8Array to hex string before validating
export const idSchema = z.preprocess((val) => {
  if (val instanceof Uint8Array) {
    return Buffer.from(val).toString("hex");
  }
  if (val != null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (isSerializedUint8Array(obj)) {
      return Buffer.from(new Uint8Array(sortedByteValues(obj))).toString("hex");
    }
  }
  return val;
}, z.string());

/**
 * AnyValue + friends 🤗
 *
 * OTLP AnyValue is effectively "oneof". This schema accepts any object that matches at
 * least one of the optional fields, but does NOT enforce exclusivity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Input type widened to accept JSON-serialized bytesValue
export const anyValueSchema: z.ZodType<OtlpAnyValue, z.ZodTypeDef, any> = z.object({
  stringValue: z.string().nullable().optional(),
  boolValue: z.union([z.boolean(), z.string()]).nullable().optional(),
  intValue: z
    .union([z.number(), z.string(), longBitsSchema])
    .nullable()
    .optional(),
  doubleValue: z.union([z.number(), z.string()]).nullable().optional(),
  arrayValue: z
    .lazy(() => arrayValueSchema)
    .optional()
    .nullable(),
  kvlistValue: z
    .lazy(() => keyValueListSchema)
    .optional()
    .nullable(),
  // JSON.stringify converts Uint8Array to {"0":1,"1":2,...} — reconstruct before validating
  bytesValue: z.preprocess((val) => {
    if (val != null && typeof val === "object" && !(val instanceof Uint8Array)) {
      const obj = val as Record<string, unknown>;
      if (isSerializedUint8Array(obj)) {
        return new Uint8Array(sortedByteValues(obj));
      }
    }
    return val;
  }, bytesSchema).optional().nullable(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const keyValueSchema: z.ZodType<OtlpKeyValue, z.ZodTypeDef, any> = z.object({
  key: z.string(),
  value: anyValueSchema,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const arrayValueSchema: z.ZodType<OtlpArrayValue, z.ZodTypeDef, any> = z.object({
  values: z.array(anyValueSchema),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const keyValueListSchema: z.ZodType<OtlpKeyValueList, z.ZodTypeDef, any> = z.object({
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
} as const satisfies Record<EStatusCode, true>;

// OTLP span kind can be either numeric (from binary format) or string (from JSON format)
export const eSpanKindSchema = z.union([
  z.nativeEnum(ESpanKind),
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
  .refine((v): v is EStatusCode => v in STATUS_CODE_SET, {
    message: "Invalid EStatusCode",
  });

/**
 * Status / Event / Link / Span
 */
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

/**
 * ScopeSpans / ResourceSpans / ExportTraceServiceRequest
 */
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
export type OtlpInstrumentationScope = z.infer<
  typeof instrumentationScopeSchema
>;
