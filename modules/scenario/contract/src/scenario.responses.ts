import type { Named } from "@langwatch/module";
/**
 * Scenario feature tRPC response schemas: declared in contract, checked in dev/test.
 */
import { z } from "zod";

import { runParameterValuesSchema } from "./scenario.parameters.ts";
import { scenarioVersionSummarySchema, scenarioVersionDetailSchema } from "./scenario.version.ts";

/** One saved version, with the human name resolved for the author it stores as an id. */
const scenarioVersionSummaryWithAuthorSchemaDefinition = scenarioVersionSummarySchema
  .safeExtend({ authorName: z.string().nullable() })
  .strict();
export interface ScenarioVersionSummaryWithAuthorSchema extends Named<
  typeof scenarioVersionSummaryWithAuthorSchemaDefinition
> {}
export const scenarioVersionSummaryWithAuthorSchema: ScenarioVersionSummaryWithAuthorSchema =
  scenarioVersionSummaryWithAuthorSchemaDefinition;
export type ScenarioVersionSummaryWithAuthor = z.infer<
  typeof scenarioVersionSummaryWithAuthorSchema
>;

/** One page of a scenario's saved versions, newest first. */
const scenarioVersionPageSchemaDefinition = z
  .object({
    versions: z.array(scenarioVersionSummaryWithAuthorSchema),
    nextCursor: z.number().int().nullable(),
  })
  .strict();
export interface ScenarioVersionPageSchema extends Named<
  typeof scenarioVersionPageSchemaDefinition
> {}
export const scenarioVersionPageSchema: ScenarioVersionPageSchema =
  scenarioVersionPageSchemaDefinition;
export type ScenarioVersionPage = z.infer<typeof scenarioVersionPageSchema>;

export { scenarioVersionDetailSchema };

/** A cancel request against one running job. */
const scenarioCancelJobResultSchemaDefinition = z.object({ cancelled: z.boolean() }).strict();
export interface ScenarioCancelJobResultSchema extends Named<
  typeof scenarioCancelJobResultSchemaDefinition
> {}
export const scenarioCancelJobResultSchema: ScenarioCancelJobResultSchema =
  scenarioCancelJobResultSchemaDefinition;
export type ScenarioCancelJobResult = z.infer<typeof scenarioCancelJobResultSchema>;

/** A cancel request against a whole batch run: how many jobs it reached. */
const scenarioCancelBatchRunResultSchemaDefinition = z
  .object({
    cancelledCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
  })
  .strict();
export interface ScenarioCancelBatchRunResultSchema extends Named<
  typeof scenarioCancelBatchRunResultSchemaDefinition
> {}
export const scenarioCancelBatchRunResultSchema: ScenarioCancelBatchRunResultSchema =
  scenarioCancelBatchRunResultSchemaDefinition;
export type ScenarioCancelBatchRunResult = z.infer<typeof scenarioCancelBatchRunResultSchema>;

/** A run was scheduled; the caller tracks it by these ids. */
const scenarioRunScheduledSchemaDefinition = z
  .object({
    scheduled: z.literal(true),
    setId: z.string(),
    batchRunId: z.string(),
    scenarioRunId: z.string(),
  })
  .strict();
export interface ScenarioRunScheduledSchema extends Named<
  typeof scenarioRunScheduledSchemaDefinition
> {}
export const scenarioRunScheduledSchema: ScenarioRunScheduledSchema =
  scenarioRunScheduledSchemaDefinition;
export type ScenarioRunScheduled = z.infer<typeof scenarioRunScheduledSchema>;

/** The batch-archive request's own report of what landed and what did not. */
const scenarioBatchArchiveResultSchemaDefinition = z
  .object({
    archived: z.array(z.string()),
    failed: z.array(z.object({ id: z.string(), error: z.string() }).strict()),
  })
  .strict();
export interface ScenarioBatchArchiveResultSchema extends Named<
  typeof scenarioBatchArchiveResultSchemaDefinition
> {}
export const scenarioBatchArchiveResultSchema: ScenarioBatchArchiveResultSchema =
  scenarioBatchArchiveResultSchemaDefinition;
export type ScenarioBatchArchiveResult = z.infer<typeof scenarioBatchArchiveResultSchema>;

// -- the Results tab --------------------------------------------------------

/** One scenario, run once against one target, inside one run — the Results tab's grain. */
const resultAtomSchemaDefinition = z
  .object({
    planSlug: z.string(),
    runId: z.string(),
    executionId: z.string(),
    runOrdinal: z.number().int(),
    runAt: z.number(),
    trigger: z.enum(["app", "code"]),
    note: z.string().nullable(),
    scenarioId: z.string(),
    scenarioKey: z.string(),
    scenarioName: z.string().nullable(),
    targetKey: z.string(),
    targetParameters: runParameterValuesSchema.nullable(),
    targetName: z.string().nullable(),
    status: z.string(),
    outcome: z.enum(["passed", "failed", "pending"]),
    durationMs: z.number().nullable(),
    costUsd: z.number().nullable(),
    costSource: z.enum(["run", "traces", "none", "unknown"]),
  })
  .strict();
export interface ResultAtomSchema extends Named<typeof resultAtomSchemaDefinition> {}
export const resultAtomSchema: ResultAtomSchema = resultAtomSchemaDefinition;
export type ResultAtomResponse = z.infer<typeof resultAtomSchema>;

/** One page of atoms, newest first, keyset paginated. */
const resultAtomsPageSchemaDefinition = z
  .object({
    atoms: z.array(resultAtomSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  })
  .strict();
export interface ResultAtomsPageSchema extends Named<typeof resultAtomsPageSchemaDefinition> {}
export const resultAtomsPageSchema: ResultAtomsPageSchema = resultAtomsPageSchemaDefinition;
export type ResultAtomsPage = z.infer<typeof resultAtomsPageSchema>;

const atomCostSchema = z
  .object({
    totalUsd: z.number(),
    knownAtoms: z.number().int().nonnegative(),
    unknownAtoms: z.number().int().nonnegative(),
  })
  .strict();

const trendPointSchema = z.object({ key: z.string(), passRate: z.number().nullable() }).strict();

const seriesBucketSchema = z
  .object({ label: z.string(), passRate: z.number().nullable(), isEmpty: z.boolean() })
  .strict();

const resultGroupSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    subtitle: z.string().nullable(),
    passRate: z.number().nullable(),
    runCount: z.number().int().nonnegative(),
    scenarioCount: z.number().int().nonnegative(),
    lastRunAt: z.number().nullable(),
    targetKeys: z.array(z.string()),
    targetParameters: runParameterValuesSchema.nullable(),
    trend: z.array(trendPointSchema),
    cost: atomCostSchema,
  })
  .strict();

const resultTotalsSchema = z
  .object({
    executions: z.number().int().nonnegative(),
    runCount: z.number().int().nonnegative(),
    passRate: z.number().nullable(),
    failingScenarios: z.number().int().nonnegative(),
    cost: atomCostSchema,
    series: z.array(seriesBucketSchema),
  })
  .strict();

/** The stat strip and the group rows for one grouping, aggregated in the database. */
const resultsOverviewSchemaDefinition = z
  .object({ totals: resultTotalsSchema, groups: z.array(resultGroupSchema) })
  .strict();
export interface ResultsOverviewSchema extends Named<typeof resultsOverviewSchemaDefinition> {}
export const resultsOverviewSchema: ResultsOverviewSchema = resultsOverviewSchemaDefinition;
export type ResultsOverviewResponse = z.infer<typeof resultsOverviewSchema>;

/** One scenario that ran from code inside the window, for the scenario filter. */
const codeScenarioSchemaDefinition = z.object({ key: z.string(), name: z.string() }).strict();
export interface CodeScenarioSchema extends Named<typeof codeScenarioSchemaDefinition> {}
export const codeScenarioSchema: CodeScenarioSchema = codeScenarioSchemaDefinition;
export type CodeScenarioResponse = z.infer<typeof codeScenarioSchema>;

/** One target the window names that the stored agent and prompt lists cannot. */
const runTargetSchemaDefinition = z
  .object({
    key: z.string(),
    referenceId: z.string().nullable(),
    parameters: runParameterValuesSchema.nullable(),
    name: z.string(),
  })
  .strict();
export interface RunTargetSchema extends Named<typeof runTargetSchemaDefinition> {}
export const runTargetSchema: RunTargetSchema = runTargetSchemaDefinition;
export type RunTargetResponse = z.infer<typeof runTargetSchema>;

/**
 * Every configuration a project's run plans already ran with, newest first.
 * `configuration` embeds the suite feature's own target shape untouched, kept
 * opaque here rather than duplicating `SuiteTarget`'s parser into this package.
 */

/** The most configurations one history read may carry back. */
export const MAX_RUN_CONFIGURATIONS = 200;

const runConfigurationEntrySchemaDefinition = z
  .object({
    key: z.string(),
    planId: z.string(),
    planName: z.string(),
    configuration: z
      .object({
        scope: z.union([
          z.object({ mode: z.literal("all") }).strict(),
          z.object({ mode: z.literal("test_suites"), testSuiteIds: z.array(z.string()) }).strict(),
          z.object({ mode: z.literal("labels"), labels: z.array(z.string()) }).strict(),
          z.object({ mode: z.literal("scenarios"), scenarioIds: z.array(z.string()) }).strict(),
        ]),
        targets: z.array(z.unknown()),
        repeatCount: z.number().int().positive(),
        simulatorModel: z.string().nullable(),
        judgeModel: z.string().nullable(),
      })
      .strict(),
    runParameters: runParameterValuesSchema,
    usesNote: z.boolean(),
    lastRunAt: z.date(),
  })
  .strict();
export interface RunConfigurationEntrySchema extends Named<
  typeof runConfigurationEntrySchemaDefinition
> {}
export const runConfigurationEntrySchema: RunConfigurationEntrySchema =
  runConfigurationEntrySchemaDefinition;
export type RunConfigurationEntryResponse = z.infer<typeof runConfigurationEntrySchema>;
