/**
 * Shared input schemas for the suite tRPC surface.
 */
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import { runNoteSchema, runParameterValuesSchema } from "@langwatch/scenario-contract";
import { MAX_PLAN_NAME_LENGTH, suiteScopeSchema, suiteTargetSchema } from "@langwatch/suite-contract";
import { z } from "zod";

export type { SuiteTarget } from "@langwatch/suite-contract";
export { suiteTargetSchema } from "@langwatch/suite-contract";

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
    simulatorModel: modelOverrideSchema.nullish(),
    judgeModel: modelOverrideSchema.nullish(),
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
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
});

/**
 * A run plan's config, as the `runPlan` mutation takes it: the rule the run
 * covers, the targets it goes against, and the two simulation model
 * overrides — everything the plan row is created or replaced with.
 */
export const runPlanConfigSchema = z.object({
  scope: suiteScopeSchema,
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number().int().min(1).max(100).optional(),
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
  /** The scenarios a hand-picked scope covers; ignored by every other. */
  scenarioIds: z.array(z.string()).optional(),
});

/**
 * Starts a run under a name: the run either joins the plan of that name and
 * replaces its config, or creates one.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
export const runPlanSchema = projectSchema.extend({
  name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH),
  config: runPlanConfigSchema,
  idempotencyKey: z.string(),
  /** Optional client-generated batch run ID for immediate placeholder feedback */
  batchRunId: z.string().optional(),
  /**
   * Constant values applied to every scenario in the run. A value supplied
   * here overrides the scenario's own default for that name.
   */
  parameters: runParameterValuesSchema.optional(),
  /**
   * One short line describing why this batch was run, stamped onto every
   * run of the batch.
   */
  note: runNoteSchema,
});
