import { z } from "zod";

// Re-export the existing evaluation input schema from server types
export { evaluationInputSchema, type EvaluationRESTParams } from "~/server/evaluations/types";

// Batch evaluation input schema for batch operations
export const batchEvaluationInputSchema = z.object({
  experiment_slug: z.string(),
  name: z.string(),
  run_id: z.string(),
  dataset: z.array(z.any()),
  evaluations: z.array(z.any()),
  progress: z.number().int().min(0),
  total: z.number().int().min(1),
  timestamps: z.object({
    created_at: z.number().int().min(0),
    finished_at: z.number().int().min(0).optional(),
    stopped_at: z.number().int().min(0).optional(),
  }),
});

export type BatchEvaluationInput = z.infer<typeof batchEvaluationInputSchema>;
