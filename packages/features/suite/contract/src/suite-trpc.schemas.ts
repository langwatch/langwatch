/**
 * What the `suites.*` and `suites.testSuites.*` doors take and answer, in the
 * shapes the browser has always sent. The model overrides are catalog-checked
 * here rather than left as bare strings, which is what the door already did.
 */
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import {
  runNoteSchema,
  runParameterValuesSchema,
  scenarioTestSuiteSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import { MAX_PLAN_NAME_LENGTH } from "./plan-name.ts";
import { runPlanConfigSchema, suiteSchema, suiteTargetSchema } from "./suite.ts";
import { SUITE_KINDS } from "./suite.kind.ts";
import { suiteScopeSchema } from "./suite.scope.ts";

const projectShape = { projectId: z.string() };
const suiteIdShape = { ...projectShape, id: z.string() };
const testSuiteIdShape = { ...projectShape, testSuiteId: z.string() };

export const suiteProjectInputSchema = z.object(projectShape);

/** One suite addressed by id, inside its project. */
export const suiteTrpcIdInputSchema = z.object(suiteIdShape);

export const testSuiteTrpcIdInputSchema = z.object(testSuiteIdShape);

/** The definition fields both writes carry, with the door's own model check. */
const suiteDefinitionShape = {
  description: z.string().optional(),
  scope: suiteScopeSchema.optional(),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number().int().min(1).max(100),
  labels: z.array(z.string()),
  // Run-plan-wide model overrides; null = use the project default
  // (scenarios.user_simulator / scenarios.judge).
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
};

/** A run plan is created with the rule it covers, the scenarios it names, or both. */
export const createSuiteTrpcInputSchema = z
  .object({
    ...projectShape,
    ...suiteDefinitionShape,
    name: z.string().min(1, "Name is required"),
    scenarioIds: z.array(z.string()).default([]),
    targets: z.array(suiteTargetSchema).default([]),
    repeatCount: z.number().int().min(1).max(100).default(1),
    labels: z.array(z.string()).default([]),
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

export const updateSuiteTrpcInputSchema = z.object({
  ...suiteIdShape,
  ...suiteDefinitionShape,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  scenarioIds: z.array(z.string()).optional(),
  targets: z.array(suiteTargetSchema).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * The contract's run plan config, tightened at the door: the two models take
 * the catalog-checked shape the rest of the model surface uses.
 */
export const runPlanConfigTrpcSchema = z.strictObject({
  ...runPlanConfigSchema.shape,
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
});

/** The values one run carries, whichever way the run was started. */
const runValuesShape = {
  idempotencyKey: z.string(),
  /** Optional client-generated batch run ID for immediate placeholder feedback */
  batchRunId: z.string().optional(),
  /**
   * Constant values applied to every scenario in the run. A value supplied
   * here overrides the scenario's own default for that name.
   */
  parameters: runParameterValuesSchema.optional(),
  /** One short line saying why this batch was run, stamped on every run of it. */
  note: runNoteSchema,
};

export const runSuiteTrpcInputSchema = z.object({ ...suiteIdShape, ...runValuesShape });

/**
 * Starts a run under a name: the run joins the plan of that name and replaces
 * its config, or creates one.
 * @see specs/suites/run-plan-identity-by-name.feature
 */
export const runPlanTrpcInputSchema = z.object({
  ...projectShape,
  ...runValuesShape,
  name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH),
  config: runPlanConfigTrpcSchema,
});

export const runAllSuitesTrpcInputSchema = z.object({
  ...projectShape,
  ...runValuesShape,
  /** Targets chosen in the run dialog; persisted for the next run's preselect. */
  targets: z.array(suiteTargetSchema).optional(),
});

export const listSuitesTrpcInputSchema = z.object({
  ...projectShape,
  kinds: z.array(z.enum(SUITE_KINDS)).min(1).optional(),
});

export const suiteArchivedNamesTrpcInputSchema = z.object({
  ...projectShape,
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
});

export const suiteSummariesTrpcInputSchema = z.object({
  ...projectShape,
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
});

export const createTestSuiteTrpcInputSchema = z.object({
  ...projectShape,
  name: z.string().trim().min(1),
});

export const renameTestSuiteTrpcInputSchema = z.object({
  ...testSuiteIdShape,
  name: z.string().trim().min(1),
});

/**
 * A row the suites surface answers with. A test suite IS a suite of kind
 * "test_suite" and the two are stored differently, so both shapes are named:
 * declaring one alone would refuse the other.
 */
export const suiteOrTestSuiteSchema = z.union([suiteSchema, scenarioTestSuiteSchema]);
export type SuiteOrTestSuiteRow = z.infer<typeof suiteOrTestSuiteSchema>;

/** The names archived scenarios and targets had when a run referenced them. */
export const suiteArchivedNamesSchema = z.object({
  scenarios: z.record(z.string(), z.string()),
  targets: z.record(z.string(), z.string()),
});

const suiteRunItemSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  target: suiteTargetSchema,
  name: z.string().optional(),
});

/** The scheduling receipt a run answers with. */
export const suiteRunReceiptSchema = z.object({
  scheduled: z.literal(true),
  batchRunId: z.string(),
  setId: z.string(),
  jobCount: z.number(),
  skippedArchived: z.object({
    scenarios: z.array(z.string()),
    targets: z.array(z.string()),
  }),
  items: z.array(suiteRunItemSchema),
});

/** The same receipt, naming the suite every run of the batch was filed under. */
export const suiteRunAllReceiptSchema = z.object({
  ...suiteRunReceiptSchema.shape,
  suiteId: z.string(),
});

/** The same receipt, naming the plan a run under a NAME joined or created. */
export const suiteRunPlanReceiptSchema = z.object({
  ...suiteRunAllReceiptSchema.shape,
  planName: z.string(),
  created: z.boolean(),
});

/** One suite's run tally, as the dashboard reads it. */
export const suiteRunSummarySchema = z.object({
  passedCount: z.number(),
  failedCount: z.number(),
  totalCount: z.number(),
  // Null until the suite has run once: the dashboard renders a dash for it.
  lastRunTimestamp: z.number().nullable(),
});

export type CreateSuiteTrpcInput = z.infer<typeof createSuiteTrpcInputSchema>;
export type UpdateSuiteTrpcInput = z.infer<typeof updateSuiteTrpcInputSchema>;
export type RunSuiteTrpcInput = z.infer<typeof runSuiteTrpcInputSchema>;
export type RunPlanTrpcInput = z.infer<typeof runPlanTrpcInputSchema>;
export type RunAllSuitesTrpcInput = z.infer<typeof runAllSuitesTrpcInputSchema>;
