import { z } from "zod";

// Evaluators list response
export const evaluatorsResponseSchema = z.object({
  evaluators: z.record(z.string(), z.object({
    name: z.string(),
    description: z.string().optional(),
    settings_json_schema: z.any(),
  })),
});

export type EvaluatorsResponse = z.infer<typeof evaluatorsResponseSchema>;

// Evaluation result response
export const evaluationResultSchema = z.object({
  id: z.string(),
  status: z.string(),
  result: z.any().optional(),
  error: z.string().optional(),
});

export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

// Batch evaluation result response
export const batchEvaluationResultSchema = z.object({
  message: z.string(),
});

export type BatchEvaluationResult = z.infer<typeof batchEvaluationResultSchema>;
