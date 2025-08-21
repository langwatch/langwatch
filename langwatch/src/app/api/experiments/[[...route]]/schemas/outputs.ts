import { z } from "zod";

/**
 * Schema for experiment initialization response
 */
export const experimentInitResponseSchema = z.object({
  path: z.string(),
  slug: z.string(),
}).strict();

export type ExperimentInitResponse = z.infer<typeof experimentInitResponseSchema>;
