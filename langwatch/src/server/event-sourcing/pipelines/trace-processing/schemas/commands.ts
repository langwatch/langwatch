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
