import { z } from "zod";

export const evaluationStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "processed",
  "error",
  "skipped",
]);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

export const evaluationCostSchema = z.object({
  amount: z.number(),
  currency: z.string(),
});
export type EvaluationCost = z.infer<typeof evaluationCostSchema>;

export const evaluationRunDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  traceId: z.string().nullable(),
  isGuardrail: z.boolean(),
  status: evaluationStatusSchema,
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  errorDetails: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Eventing's established wire shape intentionally uses this casing. */
  LastEventOccurredAt: z.number(),
  archivedAt: z.number().nullable(),
  scheduledAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  costId: z.string().nullable(),
});
export type EvaluationRunData = z.infer<typeof evaluationRunDataSchema>;

/**
 * The evaluation state shown with a trace. This deliberately has a different
 * shape from the durable evaluation-run record: transports need the nested
 * timestamps and may omit the heavy inputs payload on a degraded read.
 */
export const traceEvaluationDataSchema = z.object({
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().nullable(),
  traceId: z.string().nullable(),
  isGuardrail: z.boolean(),
  status: evaluationStatusSchema,
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  error: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  timestamps: z.object({
    scheduledAt: z.number().nullable(),
    startedAt: z.number().nullable(),
    completedAt: z.number().nullable(),
  }),
});
export type TraceEvaluationData = z.infer<typeof traceEvaluationDataSchema>;

export const evaluationSummarySchema = evaluationRunDataSchema.pick({
  evaluationId: true,
  evaluatorId: true,
  evaluatorType: true,
  evaluatorName: true,
  traceId: true,
  isGuardrail: true,
  status: true,
  score: true,
  passed: true,
  label: true,
});
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>;

export const evaluationExecutionResultSchema = z.object({
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  label: z.string().optional(),
  details: z.string().optional(),
  error: z.string().optional(),
  errorDetails: z.string().optional(),
  cost: evaluationCostSchema.optional(),
  evaluationThreadId: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
});
export type EvaluationExecutionResult = z.infer<typeof evaluationExecutionResultSchema>;
