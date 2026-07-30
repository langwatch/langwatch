import type { SerializedHandledError } from "@langwatch/handled-error";
import { z } from "zod";

/**
 * The `experiment_run` aggregate's state shape, and the event payloads that
 * mutate it (ADR-105).
 *
 * ADR-103 decision 1 is the reason this state is thin: "The run row holds
 * only what belongs to the run itself and is written once... Every count,
 * sum, rate and cost is computed at read time from the item-grain table."
 * The old pipeline's `ExperimentRunStateData` also carried `Progress`,
 * `CompletedCount`, `FailedCount`, `TotalDurationMs`, `AvgScoreBps`,
 * `PassRateBps`, `TotalScoreSum`, `ScoreCount`, `PassedCount` and
 * `GradedCount` — eleven incremented counters, all deleted here. Deriving
 * them is `totals.ts`'s job, at read time, over `items.ts`'s rows — see that
 * file for why a query cannot drift the way a counter does.
 *
 * `targets` stays structured (`ExperimentRunTarget[]`), not the old state's
 * JSON-embedded-in-state `Targets: string` — the JSON encoding is a storage
 * concern and lives in `store.ts`, not here. This file has never heard of
 * ClickHouse.
 *
 * As in the `simulation_run` and `log` rewrites, `@langwatch/event-sourcing`'s
 * `apply(state, event)` dispatches on `{ type, data }` alone — it carries no
 * envelope timestamp. Every payload below that the old fold read from
 * `event.occurredAt` therefore states `occurredAt` explicitly.
 */

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

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
 * A serialised `HandledError`, carried whole rather than mirrored
 * field-by-field — the shape is owned by `@langwatch/handled-error`, and an
 * event log that silently drops fields it was not built with is worse than
 * one that keeps them (mirrors the old `targetResultEventDataSchema`).
 */
const domainErrorSchema = z
  .custom<SerializedHandledError>(
    (value) => typeof value === "object" && value !== null,
  )
  .nullable()
  .optional();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const experimentRunStateSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  workflowVersionId: z.string().nullable(),
  /**
   * The enrolled denominator (ADR-103 decision 3): "established from the
   * enrolled set before any dispatch is attempted... a dispatch that failed
   * leaves the run visibly short of a denominator it still knows." `max` of
   * whatever `started` deliveries carry, matching the old fold and matching
   * `simulation_run.batchTotal`'s same reasoning.
   */
  total: z.number().int().nonnegative(),
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

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

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
  targets: z.array(experimentRunTargetSchema).optional(),
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

// ---------------------------------------------------------------------------
// Item-grain record (the `experimentRunResultStorage` map projection's output)
// ---------------------------------------------------------------------------

/**
 * One row of `experiment_run_items` (`items.ts`), in domain casing. This is
 * the table `totals.ts` derives every count, cost and score from — see
 * ADR-103 decision 1.
 */
export interface ExperimentRunItemRecord {
  readonly projectionId: string;
  readonly tenantId: string;
  readonly runId: string;
  readonly experimentId: string;
  readonly rowIndex: number;
  readonly targetId: string;
  readonly resultType: "target" | "evaluator";
  readonly datasetEntry: string;
  readonly predicted: string | null;
  readonly targetCost: number | null;
  readonly targetDurationMs: number | null;
  readonly targetError: string | null;
  readonly targetDomainError: string | null;
  readonly traceId: string | null;
  readonly evaluatorId: string | null;
  readonly evaluatorName: string | null;
  readonly evaluationStatus: string;
  readonly score: number | null;
  readonly label: string | null;
  /** Tri-state on the wire (`Nullable(UInt8)`): `null` unknown, `0` failed, `1` passed. */
  readonly passed: 0 | 1 | null;
  readonly evaluationDetails: string | null;
  readonly evaluationCost: number | null;
  readonly evaluationInputs: string | null;
  readonly evaluationDurationMs: number | null;
  /** Epoch ms. Customer/producer-supplied — see `items.ts`'s module docblock. */
  readonly occurredAt: number;
}
