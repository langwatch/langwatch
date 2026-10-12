import {
  serializedHandledErrorSchema as canonicalSerializedHandledErrorSchema,
  type SerializedHandledError,
} from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export type { SerializedHandledError };

const jsonRecordSchema = z.record(z.string(), z.unknown());

const experimentRunWorkflowVersionSchemaDefinition = z
  .object({
    id: z.string(),
    version: z.string(),
    commitMessage: z.string(),
    author: z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
  })
  .strict();
export interface ExperimentRunWorkflowVersionSchema extends Named<
  typeof experimentRunWorkflowVersionSchemaDefinition
> {}
export const experimentRunWorkflowVersionSchema: ExperimentRunWorkflowVersionSchema =
  experimentRunWorkflowVersionSchemaDefinition;
export type ExperimentRunWorkflowVersion = z.infer<typeof experimentRunWorkflowVersionSchema>;

const experimentRunEvaluationSummarySchemaDefinition = z
  .object({
    name: z.string(),
    averageScore: z.number().nullable(),
    averagePassed: z.number().optional(),
  })
  .strict();
export interface ExperimentRunEvaluationSummarySchema extends Named<
  typeof experimentRunEvaluationSummarySchemaDefinition
> {}
export const experimentRunEvaluationSummarySchema: ExperimentRunEvaluationSummarySchema =
  experimentRunEvaluationSummarySchemaDefinition;

const experimentRunSummarySchemaDefinition = z
  .object({
    datasetCost: z.number().optional(),
    evaluationsCost: z.number().optional(),
    datasetAverageCost: z.number().optional(),
    datasetAverageDuration: z.number().optional(),
    evaluationsAverageCost: z.number().optional(),
    evaluationsAverageDuration: z.number().optional(),
    evaluations: z.record(z.string(), experimentRunEvaluationSummarySchema),
  })
  .strict();
export interface ExperimentRunSummarySchema extends Named<
  typeof experimentRunSummarySchemaDefinition
> {}
export const experimentRunSummarySchema: ExperimentRunSummarySchema =
  experimentRunSummarySchemaDefinition;

const experimentRunTimestampsSchemaDefinition = z
  .object({
    createdAt: z.number(),
    updatedAt: z.number(),
    finishedAt: z.number().nullable().optional(),
    stoppedAt: z.number().nullable().optional(),
  })
  .strict();
export interface ExperimentRunTimestampsSchema extends Named<
  typeof experimentRunTimestampsSchemaDefinition
> {}
export const experimentRunTimestampsSchema: ExperimentRunTimestampsSchema =
  experimentRunTimestampsSchemaDefinition;

const experimentRunSchemaDefinition = z
  .object({
    experimentId: z.string(),
    runId: z.string(),
    workflowVersion: experimentRunWorkflowVersionSchema.nullable(),
    timestamps: experimentRunTimestampsSchema,
    progress: z.number().nullable().optional(),
    total: z.number().nullable().optional(),
    summary: experimentRunSummarySchema,
  })
  .strict();
export interface ExperimentRunSchema extends Named<typeof experimentRunSchemaDefinition> {}
export const experimentRunSchema: ExperimentRunSchema = experimentRunSchemaDefinition;
export type ExperimentRun = z.infer<typeof experimentRunSchema>;

const experimentRunAggregateSchemaDefinition = z
  .object({
    runsCount: z.number().int().nonnegative(),
    lastRunAt: z.number().nullable(),
  })
  .strict();
export interface ExperimentRunAggregateSchema extends Named<
  typeof experimentRunAggregateSchemaDefinition
> {}
export const experimentRunAggregateSchema: ExperimentRunAggregateSchema =
  experimentRunAggregateSchemaDefinition;
export type ExperimentRunAggregate = z.infer<typeof experimentRunAggregateSchema>;

export const serializedHandledErrorSchema = canonicalSerializedHandledErrorSchema;

const experimentRunTargetSchemaDefinition = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    promptId: z.string().nullable().optional(),
    promptVersion: z.number().nullable().optional(),
    agentId: z.string().nullable().optional(),
    evaluatorId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    metadata: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .nullable()
      .optional(),
  })
  .strict();
export interface ExperimentRunTargetSchema extends Named<
  typeof experimentRunTargetSchemaDefinition
> {}
export const experimentRunTargetSchema: ExperimentRunTargetSchema =
  experimentRunTargetSchemaDefinition;

/**
 * The eventing command shape intentionally retains Zod's default unknown-key
 * stripping behaviour. Existing event commands accepted this shape before the
 * canonical Experiment service owned it.
 */
const experimentRunCommandTargetSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  promptId: z.string().nullable().optional(),
  promptVersion: z.number().nullable().optional(),
  agentId: z.string().nullable().optional(),
  evaluatorId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});
export interface ExperimentRunCommandTargetSchema extends Named<
  typeof experimentRunCommandTargetSchemaDefinition
> {}
export const experimentRunCommandTargetSchema: ExperimentRunCommandTargetSchema =
  experimentRunCommandTargetSchemaDefinition;
export type ExperimentRunCommandTarget = z.infer<typeof experimentRunCommandTargetSchema>;

const startExperimentRunInputSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(experimentRunCommandTargetSchema),
  occurredAt: z.number(),
});
export interface StartExperimentRunInputSchema extends Named<
  typeof startExperimentRunInputSchemaDefinition
> {}
export const startExperimentRunInputSchema: StartExperimentRunInputSchema =
  startExperimentRunInputSchemaDefinition;
export type StartExperimentRunInput = z.infer<typeof startExperimentRunInputSchema>;

const recordTargetResultInputSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: jsonRecordSchema,
  predicted: jsonRecordSchema.nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  domainError: serializedHandledErrorSchema.nullable().optional(),
  traceId: z.string().nullable().optional(),
  targets: z.array(experimentRunCommandTargetSchema).optional(),
  occurredAt: z.number(),
});
export interface RecordTargetResultInputSchema extends Named<
  typeof recordTargetResultInputSchemaDefinition
> {}
export const recordTargetResultInputSchema: RecordTargetResultInputSchema =
  recordTargetResultInputSchemaDefinition;
export type RecordTargetResultInput = z.infer<typeof recordTargetResultInputSchema>;

const recordEvaluatorResultInputSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  evaluatorId: z.string(),
  evaluatorName: z.string().nullable().optional(),
  status: z.enum(["processed", "error", "skipped"]),
  score: z.number().nullable().optional(),
  label: z.string().nullable().optional(),
  passed: z.boolean().nullable().optional(),
  details: z.string().nullable().optional(),
  cost: z.number().nullable().optional(),
  inputs: jsonRecordSchema.nullable().optional(),
  duration: z.number().nullable().optional(),
  occurredAt: z.number(),
});
export interface RecordEvaluatorResultInputSchema extends Named<
  typeof recordEvaluatorResultInputSchemaDefinition
> {}
export const recordEvaluatorResultInputSchema: RecordEvaluatorResultInputSchema =
  recordEvaluatorResultInputSchemaDefinition;
export type RecordEvaluatorResultInput = z.infer<typeof recordEvaluatorResultInputSchema>;

/** How many rows and verdicts a run reported in total, as its reporter counted them. */
const experimentRunExpectedCountsSchemaDefinition = z
  .object({
    dataset: z.number().int().nonnegative(),
    evaluations: z.number().int().nonnegative(),
  })
  .strict();
export interface ExperimentRunExpectedCountsSchema extends Named<
  typeof experimentRunExpectedCountsSchemaDefinition
> {}
export const experimentRunExpectedCountsSchema: ExperimentRunExpectedCountsSchema =
  experimentRunExpectedCountsSchemaDefinition;
export type ExperimentRunExpectedCounts = z.infer<typeof experimentRunExpectedCountsSchema>;

const completeExperimentRunInputSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
  expected: experimentRunExpectedCountsSchema.optional(),
  occurredAt: z.number(),
});
export interface CompleteExperimentRunInputSchema extends Named<
  typeof completeExperimentRunInputSchemaDefinition
> {}
export const completeExperimentRunInputSchema: CompleteExperimentRunInputSchema =
  completeExperimentRunInputSchemaDefinition;
export type CompleteExperimentRunInput = z.infer<typeof completeExperimentRunInputSchema>;

const experimentRunDatasetEntrySchemaDefinition = z
  .object({
    index: z.number().int(),
    targetId: z.string().nullable().optional(),
    entry: jsonRecordSchema,
    predicted: jsonRecordSchema.optional(),
    cost: z.number().nullable().optional(),
    duration: z.number().nullable().optional(),
    error: z.string().nullable().optional(),
    domainError: serializedHandledErrorSchema.optional(),
    traceId: z.string().nullable().optional(),
  })
  .strict();
export interface ExperimentRunDatasetEntrySchema extends Named<
  typeof experimentRunDatasetEntrySchemaDefinition
> {}
export const experimentRunDatasetEntrySchema: ExperimentRunDatasetEntrySchema =
  experimentRunDatasetEntrySchemaDefinition;

const experimentRunEvaluationSchemaDefinition = z
  .object({
    evaluator: z.string(),
    name: z.string().nullable().optional(),
    targetId: z.string().nullable().optional(),
    status: z.enum(["processed", "skipped", "error"]),
    index: z.number().int(),
    score: z.number().nullable().optional(),
    label: z.string().nullable().optional(),
    passed: z.boolean().nullable().optional(),
    details: z.string().nullable().optional(),
    cost: z.number().nullable().optional(),
    duration: z.number().nullable().optional(),
    inputs: jsonRecordSchema.nullable().optional(),
  })
  .strict();
export interface ExperimentRunEvaluationSchema extends Named<
  typeof experimentRunEvaluationSchemaDefinition
> {}
export const experimentRunEvaluationSchema: ExperimentRunEvaluationSchema =
  experimentRunEvaluationSchemaDefinition;

const experimentRunStoredCountSchema = z
  .object({
    received: z.number().int().nonnegative(),
    expected: z.number().int().nonnegative().nullable(),
  })
  .strict();

/**
 * What is stored of a run against what the run reported. Results are stored after they are
 * reported, so a read can hold part of a run; `expected` is null when the run reported no counts.
 */
const experimentRunCompletenessSchemaDefinition = z
  .object({
    complete: z.boolean(),
    dataset: experimentRunStoredCountSchema,
    evaluations: experimentRunStoredCountSchema,
  })
  .strict();
export interface ExperimentRunCompletenessSchema extends Named<
  typeof experimentRunCompletenessSchemaDefinition
> {}
export const experimentRunCompletenessSchema: ExperimentRunCompletenessSchema =
  experimentRunCompletenessSchemaDefinition;
export type ExperimentRunCompleteness = z.infer<typeof experimentRunCompletenessSchema>;

const experimentRunWithItemsSchemaDefinition = z
  .object({
    experimentId: z.string(),
    runId: z.string(),
    projectId: z.string(),
    workflowVersionId: z.string().nullable().optional(),
    progress: z.number().nullable().optional(),
    total: z.number().nullable().optional(),
    targets: z.array(experimentRunTargetSchema).nullable().optional(),
    dataset: z.array(experimentRunDatasetEntrySchema),
    evaluations: z.array(experimentRunEvaluationSchema),
    timestamps: experimentRunTimestampsSchema,
    completeness: experimentRunCompletenessSchema,
  })
  .strict();
export interface ExperimentRunWithItemsSchema extends Named<
  typeof experimentRunWithItemsSchemaDefinition
> {}
export const experimentRunWithItemsSchema: ExperimentRunWithItemsSchema =
  experimentRunWithItemsSchemaDefinition;
export type ExperimentRunWithItems = z.infer<typeof experimentRunWithItemsSchema>;

const experimentRunListInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    experimentIds: z.array(z.string()),
  })
  .strict();
export interface ExperimentRunListInputSchema extends Named<
  typeof experimentRunListInputSchemaDefinition
> {}
export const experimentRunListInputSchema: ExperimentRunListInputSchema =
  experimentRunListInputSchemaDefinition;
export type ExperimentRunListInput = z.infer<typeof experimentRunListInputSchema>;

const experimentRunPageInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    experimentId: z.string(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(200),
  })
  .strict();
export interface ExperimentRunPageInputSchema extends Named<
  typeof experimentRunPageInputSchemaDefinition
> {}
export const experimentRunPageInputSchema: ExperimentRunPageInputSchema =
  experimentRunPageInputSchemaDefinition;
export type ExperimentRunPageInput = z.infer<typeof experimentRunPageInputSchema>;

const experimentRunLookupSchemaDefinition = z
  .object({
    projectId: z.string(),
    experimentId: z.string(),
    runId: z.string(),
  })
  .strict();
export interface ExperimentRunLookupSchema extends Named<
  typeof experimentRunLookupSchemaDefinition
> {}
export const experimentRunLookupSchema: ExperimentRunLookupSchema =
  experimentRunLookupSchemaDefinition;
export type ExperimentRunLookup = z.infer<typeof experimentRunLookupSchema>;

const experimentRunSlugPageInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    experimentSlug: z.string(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(200),
  })
  .strict();
export interface ExperimentRunSlugPageInputSchema extends Named<
  typeof experimentRunSlugPageInputSchemaDefinition
> {}
export const experimentRunSlugPageInputSchema: ExperimentRunSlugPageInputSchema =
  experimentRunSlugPageInputSchemaDefinition;
export type ExperimentRunSlugPageInput = z.infer<typeof experimentRunSlugPageInputSchema>;
