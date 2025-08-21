import { z } from "zod";

// Evaluators list response
export const evaluatorsResponseSchema = z.object({
  evaluators: z.record(z.string(), z.object({
    name: z.string(),
    description: z.string(),
    category: z.string(),
    docsUrl: z.string(),
    isGuardrail: z.boolean(),
    requiredFields: z.array(z.string()),
    optionalFields: z.array(z.string()),
    settings: z.record(z.unknown()),
    envVars: z.array(z.string()),
    result: z.array(z.unknown()),
    settings_json_schema: z.array(z.unknown()),
  })),
});

export type EvaluatorsResponse = z.infer<typeof evaluatorsResponseSchema>;

// Evaluation result response
export const evaluationResultSchema = z.object({
  status: z.enum(["pending", "running", "skipped", "completed", "failed"]).optional(),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  label: z.string().nullable(),
  details: z.string().nullable(),
  cost: z.object({
    amount: z.number(),
    currency: z.string(),
  }).nullable(),
  error: z.string().optional(),
});

export type EvaluationResultResponse = z.infer<typeof evaluationResultSchema>;

// Batch evaluation result response
export const batchEvaluationResultSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

export type BatchEvaluationResultResponse = z.infer<typeof batchEvaluationResultSchema>;
