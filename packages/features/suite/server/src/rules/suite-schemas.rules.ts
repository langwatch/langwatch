/**
 * Shared input schemas for the suite tRPC surface.
 */
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import { runNoteSchema, runParameterValuesSchema } from "@langwatch/scenario-contract";
import {
  MAX_PLAN_NAME_LENGTH,
  runPlanConfigSchema as suiteRunPlanConfigSchema,
  suiteScopeSchema,
  suiteTargetSchema,
} from "@langwatch/suite-contract";
import { z } from "zod";

export type { SuiteTarget } from "@langwatch/suite-contract";
export { suiteTargetSchema } from "@langwatch/suite-contract";

export const projectSchema = z.object({
  projectId: z.string(),
});

/**
 * A run plan is created with the rule it covers, the scenarios it names, or both.
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
 * The contract's run plan config, tightened at the door: `simulatorModel` and `judgeModel`
 * take the same catalog-checked shape the rest of the model surface uses rather than a
 * bare string.
 */
export const runPlanConfigSchema = suiteRunPlanConfigSchema.extend({
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
});

/**
 * Starts a run under a name: the run either joins the plan of that name and replaces its
 * config, or creates one.
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
