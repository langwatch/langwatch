import { z } from "zod";

/**
 * Command data for executing a single evaluation.
 * Sent by the evaluationTrigger reactor — one per monitor.
 * Does preconditions, sampling, execution, ES write, and emits events.
 */
export const executeEvaluationCommandDataSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  occurredAt: z.number(),
  // Thread debouncing: when > 0, traces in the same thread share one dedup key
  threadIdleTimeout: z.number().optional(),
  // Trace metadata passed from evaluationTrigger reactor
  threadId: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

export type ExecuteEvaluationCommandData = z.infer<
  typeof executeEvaluationCommandDataSchema
>;

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

export type StartEvaluationCommandData = z.infer<
  typeof startEvaluationCommandDataSchema
>;

/**
 * Command data for completing an evaluation.
 * Emitted when evaluation execution finishes (API handler path).
 */
export const completeEvaluationCommandDataSchema = z.object({
  tenantId: z.string(),
  evaluationId: z.string(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  label: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  errorDetails: z.string().nullable().optional(),
  costId: z.string().nullable().optional(),
  occurredAt: z.number(),
});

export type CompleteEvaluationCommandData = z.infer<
  typeof completeEvaluationCommandDataSchema
>;

/**
 * Command data for reporting a custom SDK evaluation atomically.
 * Combines start + complete fields so a single command emits both events,
 * avoiding ClickHouse replica lag between two separate commands.
 */
export const reportEvaluationCommandDataSchema = z.object({
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
  error: z.string().nullable().optional(),
  occurredAt: z.number(),
});

export type ReportEvaluationCommandData = z.infer<
  typeof reportEvaluationCommandDataSchema
>;
