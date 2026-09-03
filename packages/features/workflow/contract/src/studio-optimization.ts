import { z } from "zod";

import { llmConfigSchema } from "./studio-workflow";

export const studioOptimizerIds = [
  "MIPROv2",
  "MIPROv2ZeroShot",
  "BootstrapFewShotWithRandomSearch",
] as const;

export const studioOptimizerIdSchema = z.enum(studioOptimizerIds);

export const studioOptimizerParamsSchema = z.object({
  llm: llmConfigSchema.optional().nullable(),
  num_candidates: z.number().optional(),
  max_bootstrapped_demos: z.number().optional(),
  max_labeled_demos: z.number().optional(),
  max_rounds: z.number().optional(),
  num_candidate_programs: z.number().optional(),
});

export type StudioOptimizerId = z.infer<typeof studioOptimizerIdSchema>;
export type StudioOptimizerParams = z.infer<typeof studioOptimizerParamsSchema>;
