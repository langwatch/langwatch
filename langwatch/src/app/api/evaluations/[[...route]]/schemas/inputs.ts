import { z } from "zod";

// Re-export the existing evaluation input schema from server types
export { evaluationInputSchema, type EvaluationRESTParams } from "~/server/evaluations/types";

// Batch evaluation input schema for batch operations
export const batchEvaluationInputSchema = z.object({
  inputs: z.array(z.any()),
  expected_outputs: z.array(z.any()).optional(),
  settings: z.any().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type BatchEvaluationInput = z.infer<typeof batchEvaluationInputSchema>;
