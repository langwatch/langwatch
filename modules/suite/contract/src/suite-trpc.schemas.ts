/**
 * What the `suites.*` and `suites.testSuites.*` doors take and answer, in the
 * shapes the browser has always sent. The model overrides are catalog-checked
 * here rather than left as bare strings, which is what the door already did.
 */
import { modelOverrideSchema } from "@langwatch/model-provider-contract";
import type { Named } from "@langwatch/module";
import {
  evaluatorAttachmentsSchema,
  runNoteSchema,
  runParameterValuesSchema,
  scenarioTestSuiteSchema,
  suiteFieldDefinitionsSchema,
} from "@langwatch/scenario-contract";
import { z } from "zod";

import { MAX_PLAN_NAME_LENGTH } from "./plan-name.ts";
import { suiteScopeSchema } from "./suite.scope.ts";
import { SUITE_KINDS, runPlanConfigSchema, suiteSchema, suiteTargetSchema } from "./suite.ts";

const projectShape = { projectId: z.string() };
const suiteIdShape = { ...projectShape, id: z.string() };
const testSuiteIdShape = { ...projectShape, testSuiteId: z.string() };

const suiteProjectInputSchemaDefinition = z.object(projectShape);
export interface SuiteProjectInputSchema extends Named<typeof suiteProjectInputSchemaDefinition> {}
export const suiteProjectInputSchema: SuiteProjectInputSchema = suiteProjectInputSchemaDefinition;

/** One suite addressed by id, inside its project. */
const suiteTrpcIdInputSchemaDefinition = z.object(suiteIdShape);
export interface SuiteTrpcIdInputSchema extends Named<typeof suiteTrpcIdInputSchemaDefinition> {}
export const suiteTrpcIdInputSchema: SuiteTrpcIdInputSchema = suiteTrpcIdInputSchemaDefinition;

const testSuiteTrpcIdInputSchemaDefinition = z.object(testSuiteIdShape);
export interface TestSuiteTrpcIdInputSchema extends Named<
  typeof testSuiteTrpcIdInputSchemaDefinition
> {}
export const testSuiteTrpcIdInputSchema: TestSuiteTrpcIdInputSchema =
  testSuiteTrpcIdInputSchemaDefinition;

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
const createSuiteTrpcInputSchemaDefinition = z
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
export interface CreateSuiteTrpcInputSchema extends Named<
  typeof createSuiteTrpcInputSchemaDefinition
> {}
export const createSuiteTrpcInputSchema: CreateSuiteTrpcInputSchema =
  createSuiteTrpcInputSchemaDefinition;

const updateSuiteTrpcInputSchemaDefinition = z.object({
  ...suiteIdShape,
  ...suiteDefinitionShape,
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  scenarioIds: z.array(z.string()).optional(),
  targets: z.array(suiteTargetSchema).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
  // The fields a test suite declares. Refused on a run plan.
  fields: suiteFieldDefinitionsSchema.optional(),
  // The evaluators attached to the suite or the plan, the full list.
  evaluators: evaluatorAttachmentsSchema.optional(),
});
export interface UpdateSuiteTrpcInputSchema extends Named<
  typeof updateSuiteTrpcInputSchemaDefinition
> {}
export const updateSuiteTrpcInputSchema: UpdateSuiteTrpcInputSchema =
  updateSuiteTrpcInputSchemaDefinition;

/**
 * The contract's run plan config, tightened at the door: the two models take
 * the catalog-checked shape the rest of the model surface uses.
 */
const runPlanConfigTrpcSchemaDefinition = z.strictObject({
  ...runPlanConfigSchema.shape,
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
});
export interface RunPlanConfigTrpcSchema extends Named<typeof runPlanConfigTrpcSchemaDefinition> {}
export const runPlanConfigTrpcSchema: RunPlanConfigTrpcSchema = runPlanConfigTrpcSchemaDefinition;

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

const runSuiteTrpcInputSchemaDefinition = z.object({ ...suiteIdShape, ...runValuesShape });
export interface RunSuiteTrpcInputSchema extends Named<typeof runSuiteTrpcInputSchemaDefinition> {}
export const runSuiteTrpcInputSchema: RunSuiteTrpcInputSchema = runSuiteTrpcInputSchemaDefinition;

/**
 * Starts a run under a name: the run joins the plan of that name and replaces
 * its config, or creates one.
 * @see specs/suites/run-plan-identity-by-name.feature
 */
const runPlanTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  ...runValuesShape,
  name: z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH),
  config: runPlanConfigTrpcSchema,
});
export interface RunPlanTrpcInputSchema extends Named<typeof runPlanTrpcInputSchemaDefinition> {}
export const runPlanTrpcInputSchema: RunPlanTrpcInputSchema = runPlanTrpcInputSchemaDefinition;

const runAllSuitesTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  ...runValuesShape,
  /** Targets chosen in the run dialog; persisted for the next run's preselect. */
  targets: z.array(suiteTargetSchema).optional(),
});
export interface RunAllSuitesTrpcInputSchema extends Named<
  typeof runAllSuitesTrpcInputSchemaDefinition
> {}
export const runAllSuitesTrpcInputSchema: RunAllSuitesTrpcInputSchema =
  runAllSuitesTrpcInputSchemaDefinition;

const listSuitesTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  kinds: z.array(z.enum(SUITE_KINDS)).min(1).optional(),
});
export interface ListSuitesTrpcInputSchema extends Named<
  typeof listSuitesTrpcInputSchemaDefinition
> {}
export const listSuitesTrpcInputSchema: ListSuitesTrpcInputSchema =
  listSuitesTrpcInputSchemaDefinition;

const suiteArchivedNamesTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
});
export interface SuiteArchivedNamesTrpcInputSchema extends Named<
  typeof suiteArchivedNamesTrpcInputSchemaDefinition
> {}
export const suiteArchivedNamesTrpcInputSchema: SuiteArchivedNamesTrpcInputSchema =
  suiteArchivedNamesTrpcInputSchemaDefinition;

const suiteSummariesTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  startDate: z.number().int().nonnegative().optional(),
  endDate: z.number().int().nonnegative().optional(),
});
export interface SuiteSummariesTrpcInputSchema extends Named<
  typeof suiteSummariesTrpcInputSchemaDefinition
> {}
export const suiteSummariesTrpcInputSchema: SuiteSummariesTrpcInputSchema =
  suiteSummariesTrpcInputSchemaDefinition;

const createTestSuiteTrpcInputSchemaDefinition = z.object({
  ...projectShape,
  name: z.string().trim().min(1),
  fields: suiteFieldDefinitionsSchema.optional(),
  evaluators: evaluatorAttachmentsSchema.optional(),
});
export interface CreateTestSuiteTrpcInputSchema extends Named<
  typeof createTestSuiteTrpcInputSchemaDefinition
> {}
export const createTestSuiteTrpcInputSchema: CreateTestSuiteTrpcInputSchema =
  createTestSuiteTrpcInputSchemaDefinition;

const renameTestSuiteTrpcInputSchemaDefinition = z.object({
  ...testSuiteIdShape,
  name: z.string().trim().min(1),
});
export interface RenameTestSuiteTrpcInputSchema extends Named<
  typeof renameTestSuiteTrpcInputSchemaDefinition
> {}
export const renameTestSuiteTrpcInputSchema: RenameTestSuiteTrpcInputSchema =
  renameTestSuiteTrpcInputSchemaDefinition;

/** What the suite editor saves: the name, the fields and the evaluators, any of them. */
const updateTestSuiteTrpcInputSchemaDefinition = z.object({
  ...testSuiteIdShape,
  name: z.string().trim().min(1).optional(),
  fields: suiteFieldDefinitionsSchema.optional(),
  evaluators: evaluatorAttachmentsSchema.optional(),
});
export interface UpdateTestSuiteTrpcInputSchema extends Named<
  typeof updateTestSuiteTrpcInputSchemaDefinition
> {}
export const updateTestSuiteTrpcInputSchema: UpdateTestSuiteTrpcInputSchema =
  updateTestSuiteTrpcInputSchemaDefinition;

/**
 * A row the suites surface answers with. A test suite IS a suite of kind
 * "test_suite" and the two are stored differently, so both shapes are named:
 * declaring one alone would refuse the other.
 */
const suiteOrTestSuiteSchemaDefinition = z.union([suiteSchema, scenarioTestSuiteSchema]);
export interface SuiteOrTestSuiteSchema extends Named<typeof suiteOrTestSuiteSchemaDefinition> {}
export const suiteOrTestSuiteSchema: SuiteOrTestSuiteSchema = suiteOrTestSuiteSchemaDefinition;
export type SuiteOrTestSuiteRow = z.infer<typeof suiteOrTestSuiteSchema>;

/** The names archived scenarios and targets had when a run referenced them. */
const suiteArchivedNamesSchemaDefinition = z.object({
  scenarios: z.record(z.string(), z.string()),
  targets: z.record(z.string(), z.string()),
});
export interface SuiteArchivedNamesSchema extends Named<
  typeof suiteArchivedNamesSchemaDefinition
> {}
export const suiteArchivedNamesSchema: SuiteArchivedNamesSchema =
  suiteArchivedNamesSchemaDefinition;

const suiteRunItemSchema = z.object({
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  target: suiteTargetSchema,
  name: z.string().optional(),
});

/** The scheduling receipt a run answers with. */
const suiteRunReceiptSchemaDefinition = z.object({
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
export interface SuiteRunReceiptSchema extends Named<typeof suiteRunReceiptSchemaDefinition> {}
export const suiteRunReceiptSchema: SuiteRunReceiptSchema = suiteRunReceiptSchemaDefinition;

/** The same receipt, naming the suite every run of the batch was filed under. */
const suiteRunAllReceiptSchemaDefinition = z.object({
  ...suiteRunReceiptSchema.shape,
  suiteId: z.string(),
});
export interface SuiteRunAllReceiptSchema extends Named<
  typeof suiteRunAllReceiptSchemaDefinition
> {}
export const suiteRunAllReceiptSchema: SuiteRunAllReceiptSchema =
  suiteRunAllReceiptSchemaDefinition;

/** The same receipt, naming the plan a run under a NAME joined or created. */
const suiteRunPlanReceiptSchemaDefinition = z.object({
  ...suiteRunAllReceiptSchema.shape,
  planName: z.string(),
  planSlug: z.string(),
  created: z.boolean(),
});
export interface SuiteRunPlanReceiptSchema extends Named<
  typeof suiteRunPlanReceiptSchemaDefinition
> {}
export const suiteRunPlanReceiptSchema: SuiteRunPlanReceiptSchema =
  suiteRunPlanReceiptSchemaDefinition;

/** One suite's run tally, as the dashboard reads it. */
const suiteRunSummarySchemaDefinition = z.object({
  passedCount: z.number(),
  failedCount: z.number(),
  totalCount: z.number(),
  // Null until the suite has run once: the dashboard renders a dash for it.
  lastRunTimestamp: z.number().nullable(),
});
export interface SuiteRunSummarySchema extends Named<typeof suiteRunSummarySchemaDefinition> {}
export const suiteRunSummarySchema: SuiteRunSummarySchema = suiteRunSummarySchemaDefinition;

export type CreateSuiteTrpcInput = z.infer<typeof createSuiteTrpcInputSchema>;
export type UpdateSuiteTrpcInput = z.infer<typeof updateSuiteTrpcInputSchema>;
export type RunSuiteTrpcInput = z.infer<typeof runSuiteTrpcInputSchema>;
export type RunPlanTrpcInput = z.infer<typeof runPlanTrpcInputSchema>;
export type RunAllSuitesTrpcInput = z.infer<typeof runAllSuitesTrpcInputSchema>;
