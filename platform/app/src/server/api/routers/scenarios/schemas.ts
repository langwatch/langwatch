import { z } from "zod/v4";

/**
 * Shared schemas for scenario routers.
 */
export const projectSchema = z.object({
  projectId: z.string(),
});
