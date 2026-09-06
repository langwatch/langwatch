import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";
import { targetSchema } from "./shared";

export const startExperimentRunCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number(),
  targets: z.array(targetSchema),
  occurredAt: z.number(),
});

export type StartExperimentRunCommandData = z.infer<
  typeof startExperimentRunCommandDataSchema
>;

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
  /**
   * The failure's stable code, as the serialised handled error the SSE frame
   * carries. Without it the row keeps only `error` — the engine's raw string —
   * and the grid prints that to the customer on the next page load. See
   * `targetResultEventDataSchema`, which this envelope mirrors.
   */
  domainError: z
    .custom<SerializedHandledError>(
      (value) => typeof value === "object" && value !== null,
    )
    .nullable()
    .optional(),
  traceId: z.string().nullable().optional(),
  targets: z.array(targetSchema).optional(),
  /**
   * True when the cell was copied into the run from the board rather than
   * produced by it. See `targetResultEventDataSchema`, which this mirrors.
   */
  carriedOver: z.boolean().optional(),
  occurredAt: z.number(),
});

export type RecordTargetResultCommandData = z.infer<
  typeof recordTargetResultCommandDataSchema
>;

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
  inputs: z.record(z.unknown()).nullable().optional(),
  duration: z.number().nullable().optional(),
  /**
   * True when the verdict was copied into the run from the board rather than
   * produced by it. See `evaluatorResultEventDataSchema`, which this mirrors.
   */
  carriedOver: z.boolean().optional(),
  occurredAt: z.number(),
});

export type RecordEvaluatorResultCommandData = z.infer<
  typeof recordEvaluatorResultCommandDataSchema
>;

export const computeExperimentRunMetricsCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  traceId: z.string(),
  totalCost: z.number(),
  occurredAt: z.number(),
});

export type ComputeExperimentRunMetricsCommandData = z.infer<
  typeof computeExperimentRunMetricsCommandDataSchema
>;

export const completeExperimentRunCommandDataSchema = z.object({
  tenantId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
  occurredAt: z.number(),
});

export type CompleteExperimentRunCommandData = z.infer<
  typeof completeExperimentRunCommandDataSchema
>;
