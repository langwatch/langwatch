/**
 * The run's two folds, keyed by the run's aggregate key (ARCHITECTURE §9, D2 and D4): the plan
 * `started` carried, written once, and the progress each cell reads, updated per event. Split so
 * a cell's result never rewrites the plan. Design: experiment-run-execution.md section 7.
 */
import type { FoldStateRead } from "@langwatch/eventing";
import { experimentRunPlanSchema } from "@langwatch/experiment-contract";
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
export const experimentRunTargetOutputSchema = z.object({
  output: z.unknown(),
  cost: z.number().optional(),
  duration: z.number().optional(),
});

/** One evaluator's verdict on a target's row, folded into a comparison's candidates. */
export const experimentRunEvaluatorScoreSchema = z.object({
  name: z.string(),
  score: z.number().optional(),
  label: z.string().optional(),
  passed: z.boolean().optional(),
});

/** What the fold needs to know of an evaluator when its verdict arrives. */
export const experimentRunFoldEvaluatorSchema = z.object({
  /** The name a verdict carries only when the evaluator has a database record. */
  recordNamed: z.boolean(),
  fallbackName: z.string(),
  comparison: z.boolean(),
});

export const experimentRunProgressStateSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
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

export type ExperimentRunPlanFoldState = z.infer<typeof experimentRunPlanFoldStateSchema>;
export type ExperimentRunTargetOutput = z.infer<typeof experimentRunTargetOutputSchema>;
export type ExperimentRunEvaluatorScore = z.infer<typeof experimentRunEvaluatorScoreSchema>;
export type ExperimentRunFoldEvaluator = z.infer<typeof experimentRunFoldEvaluatorSchema>;
export type ExperimentRunProgressState = z.infer<typeof experimentRunProgressStateSchema>;

/** Both folds live where every replica reads them. */
export abstract class ExperimentRunFoldRepository {
  abstract readPlan(input: { runKey: string }): Promise<FoldStateRead<ExperimentRunPlanFoldState>>;
  abstract writePlan(input: { runKey: string; state: ExperimentRunPlanFoldState }): Promise<void>;
  abstract readProgress(input: {
    runKey: string;
  }): Promise<FoldStateRead<ExperimentRunProgressState>>;
  abstract writeProgress(input: {
    runKey: string;
    state: ExperimentRunProgressState;
  }): Promise<void>;
}
