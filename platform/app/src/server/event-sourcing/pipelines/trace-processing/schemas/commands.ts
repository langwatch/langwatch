import { z } from "zod";
import { TRACE_NAME_MAX_LENGTH, TRACE_NAME_MIN_LENGTH } from "./constants";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "./otlp";

export const piiRedactionLevelSchema = z.enum(["STRICT", "ESSENTIAL", "DISABLED"]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;

/**
 * Default PII redaction level when project settings are not available.
 * ESSENTIAL provides a safe default that protects user privacy.
 */
export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

export const recordSpanCommandDataSchema = z.object({
  tenantId: z.string(),
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema.optional(),
  occurredAt: z.number(),
  /**
   * ADR-022: When the serialized command payload exceeds COMMAND_INLINE_THRESHOLD (256 KB),
   * the edge spools the full span to S3 and sets this field to the S3 key. The command worker
   * fetches the spool, reconstitutes the span, then deletes the spool after event_log INSERT.
   *
   * When present, `span` contains only the minimal identifying fields (traceId, spanId);
   * when absent, `span` carries the full inline payload.
   */
  spoolRef: z.string().optional(),
});

export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;

export const assignTopicCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
  occurredAt: z.number(),
});

export type AssignTopicCommandData = z.infer<typeof assignTopicCommandDataSchema>;

export const recordLogCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  timeUnixMs: z.number(),
  severityNumber: z.number(),
  severityText: z.string(),
  body: z.string(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  scopeName: z.string(),
  scopeVersion: z.string().nullable(),
  piiRedactionLevel: piiRedactionLevelSchema.optional(),
  occurredAt: z.number(),
});

export type RecordLogCommandData = z.infer<typeof recordLogCommandDataSchema>;

export const metricTypeSchema = z.enum(["histogram", "gauge", "sum"]);
export type MetricType = z.infer<typeof metricTypeSchema>;

export const recordMetricCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  metricName: z.string(),
  metricUnit: z.string(),
  metricType: metricTypeSchema,
  value: z.number(),
  timeUnixMs: z.number(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  piiRedactionLevel: piiRedactionLevelSchema.optional(),
  occurredAt: z.number(),
});

export type RecordMetricCommandData = z.infer<
  typeof recordMetricCommandDataSchema
>;

export const resolveOriginCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  origin: z.string(),
  reason: z.string(),
  occurredAt: z.number(),
});

export type ResolveOriginCommandData = z.infer<
  typeof resolveOriginCommandDataSchema
>;

/**
 * Strict input shape for the user-facing rename API. The trim is applied
 * upstream (in the app-layer service) before this schema runs, so this
 * rejects pure-whitespace and over-long names without an extra transform
 * step that defineCommand's `z.ZodObject<z.ZodRawShape>` constraint
 * doesn't accept. Anything that fails this Zod check should bubble up
 * as a `ValidationError` (DomainError) rather than reaching the command
 * pipeline.
 */
export const changeTraceNameInputSchema = z.object({
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
});

export type ChangeTraceNameInput = z.infer<typeof changeTraceNameInputSchema>;

