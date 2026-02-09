import { z } from "zod";
import { suiteTargetSchema } from "~/server/suites/types";

// Re-export domain types so existing API-layer consumers don't break
export { suiteTargetSchema, parseSuiteTargets } from "~/server/suites/types";
export type { SuiteTarget } from "~/server/suites/types";

/**
 * Shared schemas for suite routers.
 */
export const projectSchema = z.object({
  projectId: z.string(),
});

export const createSuiteSchema = projectSchema.extend({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  scenarioIds: z.array(z.string()).min(1, "At least one scenario is required"),
  targets: z
    .array(suiteTargetSchema)
    .min(1, "At least one target is required"),
  repeatCount: z.number().int().min(1).default(1),
  labels: z.array(z.string()).default([]),
});

export const updateSuiteSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).optional(),
  labels: z.array(z.string()).optional(),
});
