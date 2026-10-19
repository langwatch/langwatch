import type { SerializedHandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { experimentRunExpectedCountsSchema } from "./experiment-run.ts";

/**
 * Target configuration for experiment run commands and events.
 */
const experimentRunEventingTargetSchemaDefinition = z.object({
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
export interface ExperimentRunEventingTargetSchema extends Named<
  typeof experimentRunEventingTargetSchemaDefinition
> {}
export const experimentRunEventingTargetSchema: ExperimentRunEventingTargetSchema =
  experimentRunEventingTargetSchemaDefinition;

export type ExperimentRunTarget = z.infer<typeof experimentRunEventingTargetSchema>;

const startExperimentRunCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(experimentRunEventingTargetSchema),
  occurredAt: z.number(),
});
export interface StartExperimentRunCommandDataSchema extends Named<
  typeof startExperimentRunCommandDataSchemaDefinition
> {}
export const startExperimentRunCommandDataSchema: StartExperimentRunCommandDataSchema =
  startExperimentRunCommandDataSchemaDefinition;

export type StartExperimentRunCommandData = z.infer<typeof startExperimentRunCommandDataSchema>;

const recordTargetResultCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: z.record(z.string(), z.unknown()),
  predicted: z.record(z.string(), z.unknown()).nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  /**
   * The failure's stable code, as the serialised handled error the SSE frame
   * carries. Without it the row keeps only `error` — the engine's raw string,
   * printed to the customer. Mirrors `targetResultEventDataSchema`.
   */
  domainError: z
    .custom<SerializedHandledError>((value) => typeof value === "object" && value !== null)
    .nullable()
    .optional(),
  traceId: z.string().nullable().optional(),
  targets: z.array(experimentRunEventingTargetSchema).optional(),
  /**
   * True when the cell was copied into the run from the board rather than
   * produced by it. See `targetResultEventDataSchema`, which this mirrors.
   */
  carriedOver: z.boolean().optional(),
  occurredAt: z.number(),
});
export interface RecordTargetResultCommandDataSchema extends Named<
  typeof recordTargetResultCommandDataSchemaDefinition
> {}
export const recordTargetResultCommandDataSchema: RecordTargetResultCommandDataSchema =
  recordTargetResultCommandDataSchemaDefinition;

export type RecordTargetResultCommandData = z.infer<typeof recordTargetResultCommandDataSchema>;

const recordEvaluatorResultCommandDataSchemaDefinition = z.object({
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
  inputs: z.record(z.string(), z.unknown()).nullable().optional(),
  duration: z.number().nullable().optional(),
  /** What a failed evaluator's frame showed (ARCHITECTURE §9): its error type, trace and code. */
  errorType: z.string().nullable().optional(),
  traceback: z.array(z.string()).nullable().optional(),
  domainError: z
    .custom<SerializedHandledError>((value) => typeof value === "object" && value !== null)
    .nullable()
    .optional(),
  /** The evaluator's raw answer, and the currency its cost is in. */
  rawResponse: z.unknown().optional(),
  costCurrency: z.string().nullable().optional(),
  /**
   * True when the verdict was copied into the run from the board rather than
   * produced by it. See `evaluatorResultEventDataSchema`, which this mirrors.
   */
  carriedOver: z.boolean().optional(),
  occurredAt: z.number(),
});
export interface RecordEvaluatorResultCommandDataSchema extends Named<
  typeof recordEvaluatorResultCommandDataSchemaDefinition
> {}
export const recordEvaluatorResultCommandDataSchema: RecordEvaluatorResultCommandDataSchema =
  recordEvaluatorResultCommandDataSchemaDefinition;

export type RecordEvaluatorResultCommandData = z.infer<
  typeof recordEvaluatorResultCommandDataSchema
>;

const computeExperimentRunMetricsCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  occurredAt: z.number(),
});
export interface ComputeExperimentRunMetricsCommandDataSchema extends Named<
  typeof computeExperimentRunMetricsCommandDataSchemaDefinition
> {}
export const computeExperimentRunMetricsCommandDataSchema: ComputeExperimentRunMetricsCommandDataSchema =
  computeExperimentRunMetricsCommandDataSchemaDefinition;

export type ComputeExperimentRunMetricsCommandData = z.infer<
  typeof computeExperimentRunMetricsCommandDataSchema
>;

const completeExperimentRunCommandDataSchemaDefinition = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
  expected: experimentRunExpectedCountsSchema.optional(),
  occurredAt: z.number(),
});
export interface CompleteExperimentRunCommandDataSchema extends Named<
  typeof completeExperimentRunCommandDataSchemaDefinition
> {}
export const completeExperimentRunCommandDataSchema: CompleteExperimentRunCommandDataSchema =
  completeExperimentRunCommandDataSchemaDefinition;

export type CompleteExperimentRunCommandData = z.infer<
  typeof completeExperimentRunCommandDataSchema
>;

/** Experiment's lifecycle facts, which peers react to from their own side (§9). */
export const EXPERIMENT_LIFECYCLE_PIPELINE_NAME = "experiment_lifecycle" as const;
export const EXPERIMENT_LIFECYCLE_AGGREGATE_TYPE = "experiment_lifecycle" as const;
export const EXPERIMENT_RAN_EVENT_TYPE = "lw.experiment.ran" as const;
export const EXPERIMENT_RAN_EVENT_VERSION = "2026-09-30" as const;

/** A person's workbench run ended (done or stopped): whose, where, and whether it was in full. */
const experimentRanEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  experimentId: z.string().nullish(),
  fullRun: z.boolean(),
});
export interface ExperimentRanEventDataSchema extends Named<
  typeof experimentRanEventDataSchemaDefinition
> {}
export const experimentRanEventDataSchema: ExperimentRanEventDataSchema =
  experimentRanEventDataSchemaDefinition;
export type ExperimentRanEventData = z.infer<typeof experimentRanEventDataSchema>;
