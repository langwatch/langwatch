import { z } from "zod";
import {
  ESpanKind,
  type EStatusCode,
  type IStatus,
  type IEvent,
  type ILink,
  type IScopeSpans,
  type IResourceSpans,
  type IExportTraceServiceRequest,
  type ISpan,
} from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import type {
  IAnyValue,
  IKeyValue,
  IArrayValue,
  IKeyValueList,
  IInstrumentationScope,
  Resource,
} from "@opentelemetry/otlp-transformer-next/build/esm/common/internal-types";

/**
 * Shared / helpers
 */
export const longBitsSchema = z.object({
  low: z.number(),
  high: z.number(),
});

export const fixed64Schema = z.union([longBitsSchema, z.string(), z.number()]);

export const bytesSchema = z.instanceof(Uint8Array);

export const idSchema = z.union([z.string(), bytesSchema]); // traceId/spanId/parentSpanId

/**
 * AnyValue + friends 🤗
 *
 * OTLP AnyValue is effectively "oneof". This schema accepts any object that matches at
 * least one of the optional fields, but does NOT enforce exclusivity.
 */
export const anyValueSchema: z.ZodType<IAnyValue> = z.object({
  stringValue: z.string().nullable().optional(),
  boolValue: z.boolean().nullable().optional(),
  intValue: z.number().nullable().optional(),
  doubleValue: z.number().nullable().optional(),
  arrayValue: z.lazy(() => arrayValueSchema).optional(),
  kvlistValue: z.lazy(() => keyValueListSchema).optional(),
  bytesValue: bytesSchema.optional(),
});

export const keyValueSchema: z.ZodType<IKeyValue> = z.object({
  key: z.string(),
  value: anyValueSchema,
});

export const arrayValueSchema: z.ZodType<IArrayValue> = z.object({
  values: z.array(anyValueSchema),
});

export const keyValueListSchema: z.ZodType<IKeyValueList> = z.object({
  values: z.array(keyValueSchema),
});

/**
 * Resource + InstrumentationScope
 */
export const resourceSchema: z.ZodType<Resource> = z.object({
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number(),
  schemaUrl: z.string().optional(),
});

export const instrumentationScopeSchema: z.ZodType<IInstrumentationScope> = z.object({
  name: z.string(),
  version: z.string().optional(),
  attributes: z.array(keyValueSchema).optional(),
  droppedAttributesCount: z.number().optional(),
});

/**
 * Enums
 */
// Compile-time completeness check for upstream OTLP EStatusCode enum changes.
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
export const statusSchema: z.ZodType<IStatus> = z.object({
  message: z.string().optional(),
  code: eStatusCodeSchema,
});

export const eventSchema: z.ZodType<IEvent> = z.object({
  timeUnixNano: fixed64Schema,
  name: z.string(),
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number(),
});

export const linkSchema: z.ZodType<ILink> = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().optional(),
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number(),
  flags: z.number().optional(),
});

export const spanSchema: z.ZodType<ISpan> = z.object({
  traceId: idSchema,
  spanId: idSchema,
  traceState: z.string().nullable().optional(),
  parentSpanId: idSchema.optional(),
  name: z.string(),
  kind: eSpanKindSchema,
  startTimeUnixNano: fixed64Schema,
  endTimeUnixNano: fixed64Schema,
  attributes: z.array(keyValueSchema),
  droppedAttributesCount: z.number(),
  events: z.array(eventSchema),
  droppedEventsCount: z.number(),
  links: z.array(linkSchema),
  droppedLinksCount: z.number(),
  status: statusSchema,
  flags: z.number().optional(),
});

/**
 * ScopeSpans / ResourceSpans / ExportTraceServiceRequest
 */
export const scopeSpansSchema: z.ZodType<IScopeSpans> = z.object({
  scope: instrumentationScopeSchema.optional(),
  spans: z.array(spanSchema).optional(),
  schemaUrl: z.string().nullable().optional(),
});

export const resourceSpansSchema: z.ZodType<IResourceSpans> = z.object({
  resource: resourceSchema.optional(),
  scopeSpans: z.array(scopeSpansSchema),
  schemaUrl: z.string().optional(),
});

export const exportTraceServiceRequestSchema: z.ZodType<IExportTraceServiceRequest> = z.object({
  resourceSpans: z.array(resourceSpansSchema).optional(),
});

export type OtlpSpan = z.infer<typeof spanSchema>;
export type OtlpResource = z.infer<typeof resourceSchema>;
export type OtlpInstrumentationScope = z.infer<typeof instrumentationScopeSchema>;
