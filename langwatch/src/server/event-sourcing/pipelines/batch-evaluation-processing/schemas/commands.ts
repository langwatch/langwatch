import { z } from "zod";

/**
 * Target configuration for batch evaluation commands.
 * Matches ESBatchEvaluationTarget type from ~/server/experiments/types.
 */
const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  prompt_id: z.string().nullable().optional(),
  prompt_version: z.number().nullable().optional(),
  agent_id: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).nullable().optional(),
});

/**
 * Command data for starting a batch evaluation.
 * Emitted when a batch evaluation run begins.
 */
export const startBatchEvaluationCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(targetSchema),
});

export type StartBatchEvaluationCommandData = z.infer<
  typeof startBatchEvaluationCommandDataSchema
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
 * Command data for completing a batch evaluation.
 * Emitted when a batch evaluation run finishes (either normally or stopped).
 */
export const completeBatchEvaluationCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});

export type CompleteBatchEvaluationCommandData = z.infer<
  typeof completeBatchEvaluationCommandDataSchema
>;
