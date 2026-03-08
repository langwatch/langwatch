import { z } from "zod";
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

export const assignSatisfactionScoreCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  satisfactionScore: z.number(),
  occurredAt: z.number(),
});

export type AssignSatisfactionScoreCommandData = z.infer<
  typeof assignSatisfactionScoreCommandDataSchema
>;

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

export const recordMetricCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  spanId: z.string(),
  metricName: z.string(),
  metricUnit: z.string(),
  metricType: z.string(),
  value: z.number(),
  timeUnixMs: z.number(),
  attributes: z.record(z.string(), z.string()),
  resourceAttributes: z.record(z.string(), z.string()),
  occurredAt: z.number(),
});

export type RecordMetricCommandData = z.infer<
  typeof recordMetricCommandDataSchema
>;
