import { z } from "zod/v4";

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const experimentRunWorkflowVersionSchema = z.object({
  id: z.string(),
  version: z.string(),
  commitMessage: z.string(),
  author: z.object({ name: z.string().nullable(), image: z.string().nullable() }).nullable(),
}).strict();
export type ExperimentRunWorkflowVersion = z.infer<typeof experimentRunWorkflowVersionSchema>;

export const experimentRunEvaluationSummarySchema = z.object({
  name: z.string(),
  averageScore: z.number().nullable(),
  averagePassed: z.number().optional(),
}).strict();

export const experimentRunSummarySchema = z.object({
  datasetCost: z.number().optional(),
  evaluationsCost: z.number().optional(),
  datasetAverageCost: z.number().optional(),
  datasetAverageDuration: z.number().optional(),
  evaluationsAverageCost: z.number().optional(),
  evaluationsAverageDuration: z.number().optional(),
  evaluations: z.record(z.string(), experimentRunEvaluationSummarySchema),
}).strict();

export const experimentRunTimestampsSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
}).strict();

export const experimentRunSchema = z.object({
  experimentId: z.string(),
  runId: z.string(),
  workflowVersion: experimentRunWorkflowVersionSchema.nullable(),
  timestamps: experimentRunTimestampsSchema,
  progress: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  summary: experimentRunSummarySchema,
}).strict();
export type ExperimentRun = z.infer<typeof experimentRunSchema>;

export const experimentRunAggregateSchema = z.object({
  runsCount: z.number().int().nonnegative(),
  lastRunAt: z.number().nullable(),
}).strict();
export type ExperimentRunAggregate = z.infer<typeof experimentRunAggregateSchema>;

export const serializedHandledErrorSchema = z.object({
  code: z.string(),
  kind: z.string(),
  meta: jsonRecordSchema,
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  traceUrl: z.string().optional(),
  httpStatus: z.number(),
  fault: z.enum(["customer", "platform", "provider"]),
  tips: z.array(z.string()).optional(),
  docsUrl: z.string().optional(),
  reasons: z.array(z.unknown()),
}).passthrough();

export const experimentRunTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  promptId: z.string().nullable().optional(),
  promptVersion: z.number().nullable().optional(),
  agentId: z.string().nullable().optional(),
  evaluatorId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
}).strict();

/**
 * The eventing command shape intentionally retains Zod's default unknown-key
 * stripping behaviour. Existing event commands accepted this shape before the
 * canonical Experiment service owned it.
 */
export const experimentRunCommandTargetSchema = z.object({
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
export type ExperimentRunCommandTarget = z.infer<
  typeof experimentRunCommandTargetSchema
>;

export const startExperimentRunInputSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(experimentRunCommandTargetSchema),
  occurredAt: z.number(),
});
export type StartExperimentRunInput = z.infer<
  typeof startExperimentRunInputSchema
>;

export const recordTargetResultInputSchema = z.object({
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
export type RecordTargetResultInput = z.infer<
  typeof recordTargetResultInputSchema
>;

export const recordEvaluatorResultInputSchema = z.object({
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
export type RecordEvaluatorResultInput = z.infer<
  typeof recordEvaluatorResultInputSchema
>;

export const completeExperimentRunInputSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
  occurredAt: z.number(),
});
export type CompleteExperimentRunInput = z.infer<
  typeof completeExperimentRunInputSchema
>;

export const experimentRunDatasetEntrySchema = z.object({
  index: z.number().int(),
  targetId: z.string().nullable().optional(),
  entry: jsonRecordSchema,
  predicted: jsonRecordSchema.optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  domainError: serializedHandledErrorSchema.optional(),
  traceId: z.string().nullable().optional(),
}).strict();

export const experimentRunEvaluationSchema = z.object({
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
}).strict();

export const experimentRunWithItemsSchema = z.object({
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
}).strict();
export type ExperimentRunWithItems = z.infer<typeof experimentRunWithItemsSchema>;

export const experimentRunListInputSchema = z.object({
  projectId: z.string(),
  experimentIds: z.array(z.string()),
}).strict();
export type ExperimentRunListInput = z.infer<typeof experimentRunListInputSchema>;

export const experimentRunPageInputSchema = z.object({
  projectId: z.string(),
  experimentId: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(200),
}).strict();
export type ExperimentRunPageInput = z.infer<typeof experimentRunPageInputSchema>;

export const experimentRunLookupSchema = z.object({
  projectId: z.string(),
  experimentId: z.string(),
  runId: z.string(),
}).strict();
export type ExperimentRunLookup = z.infer<typeof experimentRunLookupSchema>;

export const experimentRunSlugPageInputSchema = z.object({
  projectId: z.string(),
  experimentSlug: z.string(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(200),
}).strict();
export type ExperimentRunSlugPageInput = z.infer<typeof experimentRunSlugPageInputSchema>;
