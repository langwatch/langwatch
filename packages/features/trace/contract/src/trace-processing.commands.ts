import { z } from "zod";
import { normalizedSpanSchema } from "./trace.spans";
import { logTraceContributionSchema } from "./trace-log-contribution";
import { TRACE_NAME_MAX_LENGTH, TRACE_NAME_MIN_LENGTH } from "./trace.constants";
import { metricCorrelationFields } from "./trace-metric-correlation";

export {
  DEFAULT_PII_REDACTION_LEVEL,
  piiRedactionLevelSchema,
  recordSpanCommandDataSchema,
} from "./trace-ingress.commands";
export type { PIIRedactionLevel, RecordSpanCommandData } from "./trace-ingress.commands";

export const recordTraceSpanEventDataSchema = z.object({
  ingressEventId: z.string(),
  span: normalizedSpanSchema,
});

export type RecordTraceSpanEventData = z.infer<typeof recordTraceSpanEventDataSchema>;

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

export const recordLogContributionCommandDataSchema = logTraceContributionSchema;
export type RecordLogContributionCommandData = z.infer<
  typeof recordLogContributionCommandDataSchema
>;

export const recordMetricCorrelationCommandDataSchema = z.object({
  tenantId: z.string(),
  ...metricCorrelationFields,
  occurredAt: z.number(),
});

export type RecordMetricCorrelationCommandData = z.infer<
  typeof recordMetricCorrelationCommandDataSchema
>;

export const resolveOriginCommandDataSchema = z.object({
  tenantId: z.string(),
  // Must be non-empty: an empty traceId becomes an empty aggregateId on the
  // resulting OriginResolvedEvent, which then fails validation downstream in
  // the automations pipeline (recordTriggerMatch requires a non-empty traceId).
  // Reject here so the bad value never reaches the event store.
  traceId: z.string().min(1),
  origin: z.string(),
  reason: z.string(),
  occurredAt: z.number(),
});

export type ResolveOriginCommandData = z.infer<typeof resolveOriginCommandDataSchema>;

/**
 * Strict input shape for the user-facing rename API. The trim is applied
 * upstream (in the app-layer service) before this schema runs, so this
 * rejects pure-whitespace and over-long names without an extra transform
 * step that defineCommand's `z.ZodObject<z.ZodRawShape>` constraint
 * doesn't accept. Anything that fails this Zod check should bubble up
 * as a `ValidationError` (HandledError) rather than reaching the command
 * pipeline.
 */
export const changeTraceNameInputSchema = z.object({
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
});

export type ChangeTraceNameInput = z.infer<typeof changeTraceNameInputSchema>;
