import type { Named } from "@langwatch/module";
import { z } from "zod";

import { customMetadataSchema, langWatchSpanSchema } from "../../trace-format.schemas.ts";
import { TRACE_NAME_MAX_LENGTH, TRACE_NAME_MIN_LENGTH } from "../../trace.constants.ts";
import { instrumentationScopeSchema, resourceSchema, spanSchema } from "../../trace.otlp.ts";
import { normalizedSpanSchema } from "../../trace.spans.ts";
import { logTraceContributionSchema } from "../span/trace-log-contribution.ts";

export const piiRedactionLevelSchema = z.enum(["STRICT", "ESSENTIAL", "DISABLED"]);
export type PIIRedactionLevel = z.infer<typeof piiRedactionLevelSchema>;

export const DEFAULT_PII_REDACTION_LEVEL: PIIRedactionLevel = "ESSENTIAL";

/** Raw OTLP span input before durable ingress processing. */
const recordSpanCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  span: spanSchema,
  resource: resourceSchema.nullable(),
  instrumentationScope: instrumentationScopeSchema.nullable(),
  piiRedactionLevel: piiRedactionLevelSchema.optional(),
  occurredAt: z.number(),
  spoolRef: z.string().optional(),
});
export interface RecordSpanCommandDataSchema extends Named<
  typeof recordSpanCommandDataSchemaDefinition
> {}
export const recordSpanCommandDataSchema: RecordSpanCommandDataSchema =
  recordSpanCommandDataSchemaDefinition;

export type RecordSpanCommandData = z.infer<typeof recordSpanCommandDataSchema>;

const metricKindSchema = z.enum(["gauge", "sum", "histogram", "exponential_histogram", "summary"]);

/**
 * Metric exemplar correlation fields shared by ingress validation and storage
 * replay. Both enforce to prevent malformed rows; metricKind imported to prevent drift.
 */
export const metricCorrelationFields = {
  traceId: z.string().regex(/^[a-f0-9]{32}$/i),
  spanId: z.string().regex(/^[a-f0-9]{16}$/i),
  pointId: z.string().regex(/^[a-f0-9]{64}$/),
  seriesId: z.string().regex(/^[a-f0-9]{64}$/),
  metricName: z.string(),
  metricUnit: z.string(),
  metricKind: metricKindSchema,
  exemplarValue: z.number().nullable(),
  exemplarTimeUnixMs: z.number().int().nonnegative(),
} as const;

const recordCapturedSpanInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  span: langWatchSpanSchema,
  customMetadata: customMetadataSchema,
  userId: z.string().min(1),
  occurredAt: z.number(),
});
export interface RecordCapturedSpanInputSchema extends Named<
  typeof recordCapturedSpanInputSchemaDefinition
> {}
export const recordCapturedSpanInputSchema: RecordCapturedSpanInputSchema =
  recordCapturedSpanInputSchemaDefinition;

export type RecordCapturedSpanInput = z.infer<typeof recordCapturedSpanInputSchema>;

const recordTraceSpanEventDataSchemaDefinition = z.object({
  ingressEventId: z.string(),
  span: normalizedSpanSchema,
});
export interface RecordTraceSpanEventDataSchema extends Named<
  typeof recordTraceSpanEventDataSchemaDefinition
> {}
export const recordTraceSpanEventDataSchema: RecordTraceSpanEventDataSchema =
  recordTraceSpanEventDataSchemaDefinition;

const assignTopicCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  topicId: z.string().nullable(),
  topicName: z.string().nullable(),
  subtopicId: z.string().nullable(),
  subtopicName: z.string().nullable(),
  isIncremental: z.boolean(),
  occurredAt: z.number(),
});
export interface AssignTopicCommandDataSchema extends Named<
  typeof assignTopicCommandDataSchemaDefinition
> {}
export const assignTopicCommandDataSchema: AssignTopicCommandDataSchema =
  assignTopicCommandDataSchemaDefinition;

export type AssignTopicCommandData = z.infer<typeof assignTopicCommandDataSchema>;

export const recordLogContributionCommandDataSchema = logTraceContributionSchema;
export type RecordLogContributionCommandData = z.infer<
  typeof recordLogContributionCommandDataSchema
>;

const recordMetricCorrelationCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  ...metricCorrelationFields,
  occurredAt: z.number(),
});
export interface RecordMetricCorrelationCommandDataSchema extends Named<
  typeof recordMetricCorrelationCommandDataSchemaDefinition
> {}
export const recordMetricCorrelationCommandDataSchema: RecordMetricCorrelationCommandDataSchema =
  recordMetricCorrelationCommandDataSchemaDefinition;

export type RecordMetricCorrelationCommandData = z.infer<
  typeof recordMetricCorrelationCommandDataSchema
>;

const resolveOriginCommandDataSchemaDefinition = z.object({
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
export interface ResolveOriginCommandDataSchema extends Named<
  typeof resolveOriginCommandDataSchemaDefinition
> {}
export const resolveOriginCommandDataSchema: ResolveOriginCommandDataSchema =
  resolveOriginCommandDataSchemaDefinition;

export type ResolveOriginCommandData = z.infer<typeof resolveOriginCommandDataSchema>;

/**
 * Input shape for rename API. Trim applied upstream; schema rejects
 * whitespace/over-length without extra step. Failures are HandledError.
 */
const changeTraceNameInputSchemaDefinition = z.object({
  newName: z.string().min(TRACE_NAME_MIN_LENGTH).max(TRACE_NAME_MAX_LENGTH),
});
export interface ChangeTraceNameInputSchema extends Named<
  typeof changeTraceNameInputSchemaDefinition
> {}
export const changeTraceNameInputSchema: ChangeTraceNameInputSchema =
  changeTraceNameInputSchemaDefinition;

/**
 * Trace owns the durable assignment command that materialises a clustered
 * topic on its trace projections. Other features use this portable command
 * port rather than reaching into Trace's Eventing pipeline.
 */
export abstract class TraceTopicAssignment {
  abstract assignTopic(input: AssignTopicCommandData): Promise<void>;
}
