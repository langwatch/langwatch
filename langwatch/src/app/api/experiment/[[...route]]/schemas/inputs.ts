import { z } from "zod";

/**
 * Schema for experiment initialization parameters
 */
export const experimentInitInputSchema = z.strictObject({
  experiment_id: z.string().optional().nullable(),
  experiment_slug: z.string().optional().nullable(),
  experiment_type: z.enum([
    "DSPY",
    "BATCH_EVALUATION",
    "BATCH_EVALUATION_V2",
  ]),
  experiment_name: z.string().optional(),
  workflowId: z.string().optional(),
}).refine((data) => {
  if (!data.experiment_id && !data.experiment_slug) {
    return false;
  }
  return true;
}, {
  message: "Either experiment_id or experiment_slug is required",
  path: ["experiment_id", "experiment_slug"],
});

export type ExperimentInitInput = z.infer<typeof experimentInitInputSchema>;
