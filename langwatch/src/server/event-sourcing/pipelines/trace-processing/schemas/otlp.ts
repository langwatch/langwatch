import { z } from "zod";
import {
  ESpanKind,
  type EStatusCode,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";

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

export const idSchema = z.union([
  z.string(),
  bytesSchema,
  // This is needed, because JSON.stringify converts Uint8Array to an object, lol.
  z
    .record(z.string(), z.number())
    .transform((obj) => {
      const values = Object.entries(obj)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, v]) => v);
      return Buffer.from(new Uint8Array(values)).toString("hex");
    }),
]);

/**
 * AnyValue + friends 🤗
 *
 * OTLP AnyValue is effectively "oneof". This schema accepts any object that matches at
 * least one of the optional fields, but does NOT enforce exclusivity.
 */
export const anyValueSchema: z.ZodType<OtlpAnyValue> = z.object({
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
  bytesValue: bytesSchema.optional().nullable(),
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
} as const satisfies Record<EStatusCode, true>;

export const eSpanKindSchema = z.nativeEnum(ESpanKind);

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
  events: z.array(eventSchema),
  links: z.array(linkSchema),
  status: statusSchema,
  flags: z.number().optional().nullable(),
  droppedAttributesCount: z.number().nullable(),
  droppedEventsCount: z.number().nullable(),
  droppedLinksCount: z.number().nullable(),
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
