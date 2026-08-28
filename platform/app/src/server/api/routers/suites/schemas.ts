import { z } from "zod";
import { suiteScopeSchema } from "~/server/suites/scope";
import { suiteTargetSchema } from "~/server/suites/types";

export type { SuiteTarget } from "~/server/suites/types";
// Re-export domain types so existing API-layer consumers don't break
export { parseSuiteTargets, suiteTargetSchema } from "~/server/suites/types";

/**
 * Shared schemas for suite routers.
 */
export const projectSchema = z.object({
  projectId: z.string(),
});

/**
 * A run plan is created with the rule it covers, the scenarios it names, or both.
 *
 * `scenarioIds` is required only for a plan that runs a hand-picked list,
 * which is what a plan with no scope also means. A dynamic scope resolves its
 * own list at run time, so a list given with it is only the cache.
 *
 * Targets are no longer asked for here: the run dialog is where an agent or a
 * prompt is chosen, and a run with none is refused with
 * `suite_targets_required`.
 */
export const createSuiteSchema = projectSchema
  .extend({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    scenarioIds: z.array(z.string()).default([]),
    scope: suiteScopeSchema.optional(),
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
    // Run-plan-wide model overrides; null = use the project default
    // (scenarios.user_simulator / scenarios.judge).
    simulatorModel: z.string().nullish(),
    judgeModel: z.string().nullish(),
  })
  .superRefine((input, ctx) => {
    const picksCases = !input.scope || input.scope.mode === "scenarios";
    if (picksCases && input.scenarioIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scenarioIds"],
        message: "At least one scenario is required",
      });
    }
  });

export const updateSuiteSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  scenarioIds: z.array(z.string()).optional(),
  scope: suiteScopeSchema.optional(),
  targets: z.array(suiteTargetSchema).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
});
