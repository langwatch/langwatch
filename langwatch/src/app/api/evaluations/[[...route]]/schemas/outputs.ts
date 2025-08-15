import { z } from "zod";

// Evaluators list response
export const evaluatorsResponseSchema = z.object({
  evaluators: z.record(z.string(), z.object({
    name: z.string(),
    description: z.string().optional(),
    settings_json_schema: z.unknown(),
  })),
});

export type EvaluatorsResponse = z.infer<typeof evaluatorsResponseSchema>;

// Evaluation result response
export const evaluationResultSchema = z.object({
  id: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "failed"]).optional(),
  result: z.unknown().optional(),
  cost: z.object({
    amount: z.number(),
    currency: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export type EvaluationResultResponse = z.infer<typeof evaluationResultSchema>;

// Batch evaluation result response
export const batchEvaluationResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export type BatchEvaluationResultResponse = z.infer<typeof batchEvaluationResultSchema>;
