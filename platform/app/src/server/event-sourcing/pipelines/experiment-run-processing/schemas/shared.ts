import { z } from "zod";

/**
 * Target configuration for experiment run commands and events.
 */
export const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  promptId: z.string().nullable().optional(),
  promptVersion: z.number().nullable().optional(),
  agentId: z.string().nullable().optional(),
  evaluatorId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});

export type ExperimentRunTarget = z.infer<typeof targetSchema>;
