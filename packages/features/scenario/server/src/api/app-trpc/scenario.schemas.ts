/**
 * Shared input schemas for the scenario tRPC surface.
 */
import { z } from "zod";

export const projectSchema = z.object({
  projectId: z.string(),
});
