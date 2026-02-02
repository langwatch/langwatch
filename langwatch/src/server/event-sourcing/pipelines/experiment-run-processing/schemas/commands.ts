import { z } from "zod";
import { targetSchema } from "./shared";

/**
 * Command data for starting an experiment run.
 * Emitted when an experiment run begins.
 */
export const startExperimentRunCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(targetSchema),
});

export type StartExperimentRunCommandData = z.infer<
  typeof startExperimentRunCommandDataSchema
>;

/**
 * Command data for recording a target result.
 * Emitted when a target execution completes for a row.
 */
export const recordTargetResultCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  index: z.number(),
  targetId: z.string(),
  entry: z.record(z.unknown()),
  predicted: z.record(z.unknown()).nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  traceId: z.string().nullable().optional(),
});

export type RecordTargetResultCommandData = z.infer<
  typeof recordTargetResultCommandDataSchema
>;

/**
 * Command data for recording an evaluator result.
 * Emitted when an evaluator completes for a row.
 */
export const recordEvaluatorResultCommandDataSchema = z.object({
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
});

export type RecordEvaluatorResultCommandData = z.infer<
  typeof recordEvaluatorResultCommandDataSchema
>;

/**
 * Command data for completing an experiment run.
 * Emitted when an experiment run finishes (either normally or stopped).
 */
export const completeExperimentRunCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});

export type CompleteExperimentRunCommandData = z.infer<
  typeof completeExperimentRunCommandDataSchema
>;
