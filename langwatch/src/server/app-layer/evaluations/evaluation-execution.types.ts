import { z } from "zod";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const executeForTraceParamsSchema = z.object({
  projectId: z.string(),
  traceId: z.string(),
  evaluatorType: z.string(),
  settings: z.record(z.unknown()).nullable(),
  mappings: z.record(z.unknown()).nullable(),
  level: z.enum(["trace", "thread"]).optional(),
  workflowId: z.string().nullable().optional(),
});

export type ExecuteForTraceParams = z.infer<typeof executeForTraceParamsSchema>;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const evaluationCostSchema = z.object({
  amount: z.number(),
  currency: z.string(),
});

export type EvaluationCost = z.infer<typeof evaluationCostSchema>;

export const evaluationExecutionResultSchema = z.object({
  status: z.enum(["processed", "error", "skipped"]),
  // Why a skipped result occurred. "missing_thread_id" marks a thread-based
  // evaluation on a trace that carries no thread_id — it can never succeed, so
  // callers drop it silently (no result event) rather than recording a skip.
  skipReason: z.enum(["missing_thread_id"]).optional(),
  score: z.number().optional(),
  passed: z.boolean().optional(),
  label: z.string().optional(),
  details: z.string().optional(),
  error: z.string().optional(),
  errorDetails: z.string().optional(),
  cost: evaluationCostSchema.optional(),
  evaluationThreadId: z.string().optional(),
  inputs: z.record(z.any()).optional(),
});

export type EvaluationExecutionResult = z.infer<
  typeof evaluationExecutionResultSchema
>;
