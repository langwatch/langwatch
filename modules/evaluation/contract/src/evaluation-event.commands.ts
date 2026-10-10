import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * Command data for executing a single evaluation.
 * Sent by the evaluationTrigger subscriber — one per monitor.
 * Does preconditions, sampling, execution, ES write, and emits events.
 */
const executeEvaluationCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  occurredAt: z.number(),
  // The evaluated trace's last span end: the reported event's business time; absent, occurredAt
  spanEndedAt: z.number().optional(),
  // Thread debouncing: when > 0, traces in the same thread share one dedup key
  threadIdleTimeout: z.number().optional(),
  // Trace metadata passed from evaluationTrigger subscriber
  threadId: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  // Precondition fields added for expanded filtering
  origin: z.string().optional(),
  hasError: z.boolean().optional(),
  promptIds: z.array(z.string()).optional(),
  // Additional fields for expanded precondition matching
  topicId: z.string().optional(),
  subTopicId: z.string().optional(),
  customMetadata: z.record(z.string(), z.string()).optional(),
  spanTypes: z.array(z.string()).optional(),
  spanModels: z.array(z.string()).optional(),
  computedInput: z.string().nullable().optional(),
  computedOutput: z.string().nullable().optional(),
});
export interface ExecuteEvaluationCommandDataSchema extends Named<
  typeof executeEvaluationCommandDataSchemaDefinition
> {}
export const executeEvaluationCommandDataSchema: ExecuteEvaluationCommandDataSchema =
  executeEvaluationCommandDataSchemaDefinition;

export type ExecuteEvaluationCommandData = z.infer<typeof executeEvaluationCommandDataSchema>;

/**
 * Base evaluation data shared across commands.
 */
const baseEvaluationSchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  occurredAt: z.number(),
});

/**
 * Command data for starting an evaluation.
 * Emitted when evaluation execution begins (API handler path).
 */
export const startEvaluationCommandDataSchema = baseEvaluationSchema;

export type StartEvaluationCommandData = z.infer<typeof startEvaluationCommandDataSchema>;

/**
 * Command data for completing an evaluation.
 * Emitted when evaluation execution finishes (API handler path).
 */
const completeEvaluationCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
  occurredAt: z.number(),
});
export interface CompleteEvaluationCommandDataSchema extends Named<
  typeof completeEvaluationCommandDataSchemaDefinition
> {}
export const completeEvaluationCommandDataSchema: CompleteEvaluationCommandDataSchema =
  completeEvaluationCommandDataSchemaDefinition;

export type CompleteEvaluationCommandData = z.infer<typeof completeEvaluationCommandDataSchema>;

/**
 * Command data for reporting a custom SDK evaluation atomically.
 * Combines start + complete fields so a single command emits both events,
 * avoiding ClickHouse replica lag between two separate commands.
 */
const reportEvaluationCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  traceId: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
  occurredAt: z.number(),
});
export interface ReportEvaluationCommandDataSchema extends Named<
  typeof reportEvaluationCommandDataSchemaDefinition
> {}
export const reportEvaluationCommandDataSchema: ReportEvaluationCommandDataSchema =
  reportEvaluationCommandDataSchemaDefinition;

export type ReportEvaluationCommandData = z.infer<typeof reportEvaluationCommandDataSchema>;
