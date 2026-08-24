import { z } from "zod/v4";
import { suiteTargetSchema } from "@langwatch/suite-contract";

export type { SuiteTarget } from "@langwatch/suite-contract";
export { suiteTargetSchema } from "@langwatch/suite-contract";

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
  targets: z.array(suiteTargetSchema).min(1, "At least one target is required"),
  repeatCount: z.number().int().min(1).max(100).default(1),
  labels: z.array(z.string()).default([]),
  // Run-plan-wide model overrides; null = use the project default
  // (scenarios.user_simulator / scenarios.judge).
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
});

export const updateSuiteSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
});
