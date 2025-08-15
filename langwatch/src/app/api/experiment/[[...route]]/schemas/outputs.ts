import { z } from "zod";

/**
 * Schema for experiment initialization response
 */
export const experimentInitResponseSchema = z.strictObject({
  path: z.string(),
  slug: z.string(),
});

export type ExperimentInitResponse = z.infer<typeof experimentInitResponseSchema>;
