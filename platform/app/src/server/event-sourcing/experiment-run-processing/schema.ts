import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";

/**
 * The `experiment_run` aggregate's state and event payloads (ADR-105).
 *
 * The state is thin on purpose (ADR-103 decision 1): the run row holds only
 * what belongs to the run itself, and every count, sum, rate and cost is
 * computed at read time from the item rows — see `totals.ts`.
 */

export const experimentRunTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  promptId: z.string().nullable().optional(),
  promptVersion: z.number().nullable().optional(),
  agentId: z.string().nullable().optional(),
  evaluatorId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  metadata: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .nullable()
    .optional(),
});
export type ExperimentRunTarget = z.infer<typeof experimentRunTargetSchema>;

/**
 * A serialised `HandledError`, carried whole rather than mirrored field by
 * field — the shape is owned by `@langwatch/handled-error`, and an event log
 * that drops fields it was not built with is worse than one that keeps them.
 */
const domainErrorSchema = z
  .custom<SerializedHandledError>(
    (value) => typeof value === "object" && value !== null,
  )
  .nullable()
  .optional();

export const experimentRunStateSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable(),
  /**
   * The enrolled denominator (ADR-103 decision 3), established before any
   * dispatch is attempted, so a dispatch that failed leaves the run visibly
   * short of a denominator it still knows. `max` of whatever the `started`
   * deliveries carry.
   */
  total: z.number().int().nonnegative(),
  /** The run's declared targets — experiment configuration, not work. */
  targets: z.array(experimentRunTargetSchema),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  stoppedAt: z.number().nullable(),
});
export type ExperimentRunState = z.infer<typeof experimentRunStateSchema>;

export function initExperimentRunState(): ExperimentRunState {
  return {
    runId: "",
    experimentId: "",
    workflowVersionId: null,
    total: 0,
    targets: [],
    startedAt: null,
    finishedAt: null,
    stoppedAt: null,
  };
}

// `apply(state, event)` dispatches on `{ type, data }` alone — there is no
// envelope timestamp — so every payload a handler derives a time from states
// `occurredAt` itself.

export const runStartedDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable().optional(),
  total: z.number().int().nonnegative(),
  targets: z.array(experimentRunTargetSchema),
  occurredAt: z.number(),
});
export type RunStartedData = z.infer<typeof runStartedDataSchema>;

export const targetResultDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  index: z.number().int().nonnegative(),
  targetId: z.string(),
  entry: z.record(z.unknown()),
  predicted: z.record(z.unknown()).nullable().optional(),
  cost: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  error: z.string().nullable().optional(),
  domainError: domainErrorSchema,
  traceId: z.string().nullable().optional(),
  occurredAt: z.number(),
});
export type TargetResultData = z.infer<typeof targetResultDataSchema>;

export const evaluatorResultDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  index: z.number().int().nonnegative(),
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
export type EvaluatorResultData = z.infer<typeof evaluatorResultDataSchema>;

export const runCompletedDataSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  finishedAt: z.number().nullable().optional(),
  stoppedAt: z.number().nullable().optional(),
});
export type RunCompletedData = z.infer<typeof runCompletedDataSchema>;
