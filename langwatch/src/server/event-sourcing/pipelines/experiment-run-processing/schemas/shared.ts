import { z } from "zod";

/**
 * Target configuration for experiment run commands and events.
 * Matches ESBatchEvaluationTarget type from ~/server/experiments/types.
 */
export const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  prompt_id: z.string().nullable().optional(),
  prompt_version: z.number().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});

export type ExperimentRunTarget = z.infer<typeof targetSchema>;
