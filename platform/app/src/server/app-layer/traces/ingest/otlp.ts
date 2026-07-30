import {
  ESpanKind,
  type EStatusCode,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import { z } from "zod";

/**
 * The OTLP trace wire shape, exactly as a collector sends it — before
 * normalization, redaction or canonicalisation. Every field is tolerant on
 * purpose: the same span arrives as protobuf (numeric enums, Uint8Array ids,
 * Long bit pairs) or as JSON (string enums, hex ids, decimal strings).
 */

const longBitsSchema = z.object({
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

type OtlpArrayValue = {
  values: OtlpAnyValue[];
};

type OtlpKeyValueList = {
  values: OtlpKeyValue[];
};

const fixed64Schema = z.union([longBitsSchema, z.string(), z.number()]);

const bytesSchema = z.instanceof(Uint8Array);

const NUMERIC_KEY = /^\d+$/;

/** JSON.stringify turns a Uint8Array into {"0":1,"1":2,...}. */
function isSerializedUint8Array(
  obj: Record<string, unknown>,
): obj is Record<string, number> {
  return Object.entries(obj).every(
    ([k, v]) =>
      NUMERIC_KEY.test(k) &&
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= 0 &&
      v <= 255,
  );
}

function sortedByteValues(obj: Record<string, number>): number[] {
  return Object.entries(obj)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, v]) => v);
}

const idSchema = z.preprocess((val) => {
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
 * OTLP `AnyValue` is a oneof. This accepts any object matching at least one
 * variant and does NOT enforce exclusivity.
 */
// biome-ignore lint/suspicious/noExplicitAny: input side widened to accept a JSON-serialized bytesValue
const anyValueSchema: z.ZodType<OtlpAnyValue, z.ZodTypeDef, any> = z.object({
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
  bytesValue: z
    .preprocess((val) => {
      if (
        val != null &&
        typeof val === "object" &&
        !(val instanceof Uint8Array)
      ) {
        const obj = val as Record<string, unknown>;
        if (isSerializedUint8Array(obj)) {
          return new Uint8Array(sortedByteValues(obj));
        }
      }
      return val;
    }, bytesSchema)
    .optional()
    .nullable(),
});

// biome-ignore lint/suspicious/noExplicitAny: mirrors anyValueSchema's widened input
const keyValueSchema: z.ZodType<OtlpKeyValue, z.ZodTypeDef, any> = z.object({
  key: z.string(),
  value: anyValueSchema,
});

// biome-ignore lint/suspicious/noExplicitAny: mirrors anyValueSchema's widened input
const arrayValueSchema: z.ZodType<OtlpArrayValue, z.ZodTypeDef, any> = z.object(
  {
    values: z.array(anyValueSchema),
  },
);

// biome-ignore lint/suspicious/noExplicitAny: mirrors anyValueSchema's widened input
const keyValueListSchema: z.ZodType<OtlpKeyValueList, z.ZodTypeDef, any> =
  z.object({
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

const eSpanKindSchema = z.union([
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

const eStatusCodeSchema = z
  .number()
  .int()
  .refine((v): v is EStatusCode => v in STATUS_CODE_SET, {
    message: "Invalid EStatusCode",
  });

const statusSchema = z.object({
  message: z.string().optional().nullable(),
  code: eStatusCodeSchema.optional().nullable(),
});

const eventSchema = z.object({
  timeUnixNano: fixed64Schema,
  name: z.string(),
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number().optional().nullable(),
});

const linkSchema = z.object({
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

export type OtlpSpan = z.infer<typeof spanSchema>;
export type OtlpResource = z.infer<typeof resourceSchema>;
export type OtlpInstrumentationScope = z.infer<
  typeof instrumentationScopeSchema
>;
