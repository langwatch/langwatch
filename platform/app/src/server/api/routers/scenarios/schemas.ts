import { z } from "zod";

/**
 * Shared schemas for scenario routers.
 */
export const projectSchema = z.object({
  projectId: z.string(),
});
