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
  traceId: z.string().nullable().optional(),
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
  occurredAt: z.number(),
});

export type RecordEvaluatorResultCommandData = z.infer<
  typeof recordEvaluatorResultCommandDataSchema
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
