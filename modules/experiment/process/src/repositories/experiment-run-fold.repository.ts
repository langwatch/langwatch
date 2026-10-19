/**
 * The run's two folds (ARCHITECTURE §9, D2 and D4): the plan `started` carried, written once under
 * the run's aggregate key, and its progress, updated per event under main's poller key by runId.
 * Split so a cell's result never rewrites the plan. Design: experiment-run-execution.md section 7.
 */
import type { FoldStateRead } from "@langwatch/eventing";
import {
  type EvaluationV3Event,
  executionSummarySchema,
  experimentRunPlanSchema,
} from "@langwatch/experiment-contract";
import { serializedHandledErrorSchema } from "@langwatch/handled-error";
import { z } from "zod";

const foldTimestampsShape = {
  CreatedAt: z.number(),
  UpdatedAt: z.number(),
  LastEventOccurredAt: z.number(),
};

/** The run's plan, as `started` carried it; null for a run started before runs carried one. */
export const experimentRunPlanFoldStateSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  plan: experimentRunPlanSchema.nullable(),
  ...foldTimestampsShape,
});

/** A target's output on one row, as a comparison reads it. */
const experimentRunTargetOutputSchema = z.object({
  output: z.unknown(),
  cost: z.number().optional(),
  duration: z.number().optional(),
});

/** One evaluator's verdict on a target's row, folded into a comparison's candidates. */
const experimentRunEvaluatorScoreSchema = z.object({
  name: z.string(),
  score: z.number().optional(),
  label: z.string().optional(),
  passed: z.boolean().optional(),
});

/** What the fold needs to know of an evaluator when its verdict arrives. */
const experimentRunFoldEvaluatorSchema = z.object({
  /** The name a verdict carries only when the evaluator has a database record. */
  recordNamed: z.boolean(),
  fallbackName: z.string(),
  comparison: z.boolean(),
});

/** One frame main's SSE sent, as a recorded event produced it. */
const experimentRunFrameSchema = z.custom<EvaluationV3Event>(
  (value) => typeof value === "object" && value !== null && "type" in value,
);

/** A frame the run streamed, numbered in the run's order, with the event that produced it. */
const experimentRunRecentEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  eventId: z.string(),
  frame: experimentRunFrameSchema,
});

export const experimentRunProgressStateSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  /** Main's poller JSON: the run as `GET /runs/:runId` answers it. */
  experimentSlug: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "stopped"]),
  /** Cells finished, failed ones included. */
  progress: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  summary: executionSummarySchema.optional(),
  error: z.string().optional(),
  domainError: serializedHandledErrorSchema.optional(),
  traceId: z.string().optional(),
  /** The last 50 frames, as main kept them; `seq` numbers every frame the run streamed. */
  recentEvents: z.array(experimentRunRecentEventSchema),
  seq: z.number().int().nonnegative(),
  runUrl: z.string().optional(),
  /** Of `progress`, the cells that failed. */
  failed: z.number().int().nonnegative(),
  persistResults: z.boolean(),
  /** Each cell's result frames, kept only for a run that writes its cells back to the board. */
  resultFrames: z.record(z.string(), experimentRunFrameSchema),
  /** False for a run started before runs carried a plan: folded, never stored. */
  planned: z.boolean(),
  phaseOneCells: z.number().int().nonnegative(),
  evaluators: z.record(z.string(), experimentRunFoldEvaluatorSchema),
  /** One bit per finished cell ordinal, base64. */
  finishedCells: z.string(),
  /** Keyed `<rowIndex>:<targetId>`. */
  targetOutputs: z.record(z.string(), experimentRunTargetOutputSchema),
  /** Keyed `<rowIndex>:<targetId>`. */
  traceIds: z.record(z.string(), z.string()),
  /** Keyed `<rowIndex>:<targetId>`, then evaluator id. */
  evaluatorScores: z.record(z.string(), z.record(z.string(), experimentRunEvaluatorScoreSchema)),
  ...foldTimestampsShape,
});

/** A polled run's start as the api answered it, read until the progress fold holds the run. */
export const experimentRunStartRecordSchema = experimentRunProgressStateSchema.pick({
  projectId: true,
  runId: true,
  experimentId: true,
  total: true,
  startedAt: true,
});

export type ExperimentRunStartRecord = z.infer<typeof experimentRunStartRecordSchema>;
export type ExperimentRunPlanFoldState = z.infer<typeof experimentRunPlanFoldStateSchema>;
export type ExperimentRunTargetOutput = z.infer<typeof experimentRunTargetOutputSchema>;
export type ExperimentRunEvaluatorScore = z.infer<typeof experimentRunEvaluatorScoreSchema>;
export type ExperimentRunFoldEvaluator = z.infer<typeof experimentRunFoldEvaluatorSchema>;
export type ExperimentRunRecentEvent = z.infer<typeof experimentRunRecentEventSchema>;
export type ExperimentRunProgressState = z.infer<typeof experimentRunProgressStateSchema>;

/** Both folds live where every replica reads them. */
export abstract class ExperimentRunFoldRepository {
  abstract readPlan(input: { runKey: string }): Promise<FoldStateRead<ExperimentRunPlanFoldState>>;
  abstract writePlan(input: { runKey: string; state: ExperimentRunPlanFoldState }): Promise<void>;
  /** A run's progress by its id alone, as main's poller keyed it. */
  abstract readRunProgress(input: {
    runId: string;
  }): Promise<FoldStateRead<ExperimentRunProgressState>>;
  abstract writeProgress(input: { state: ExperimentRunProgressState }): Promise<void>;
  /** Kept beside the progress fold, so a poll before the worker folds the run reads it running. */
  abstract recordRunStart(input: { start: ExperimentRunStartRecord }): Promise<void>;
  abstract findRunStart(input: { runId: string }): Promise<ExperimentRunStartRecord[]>;
}
