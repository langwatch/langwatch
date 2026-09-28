/**
 * How a cell reads the run's folds: its own cell out of the plan, the target as the run pinned it,
 * and the outputs and verdicts a comparison judges. Pure; the cell service does the reading.
 * Design: specs/experiment-run-execution.md sections 7 and 8.
 */
import {
  type EvaluationsV3State,
  type ExecutionCell,
  type ExperimentRunPlan,
  type ExperimentRunPlanCell,
  type ExperimentRunTargetCell,
  isComparisonEvaluator,
  type TargetConfig,
} from "@langwatch/experiment-contract";

import type {
  ExperimentRunEvaluatorScore,
  ExperimentRunFoldEvaluator,
  ExperimentRunProgressState,
  ExperimentRunTargetOutput,
} from "../repositories/experiment-run-fold.repository.ts";
import { countFinished } from "./experiment-run-window.rules.ts";

/** The key a row's output on one target is folded under, as main's in-memory caches keyed it. */
export function runCellKey({ rowIndex, targetId }: { rowIndex: number; targetId: string }): string {
  return `${rowIndex}:${targetId}`;
}

/** What the progress fold needs of each evaluator to name and keep its verdicts. */
export function foldEvaluatorsOf(
  plan: ExperimentRunPlan,
): Record<string, ExperimentRunFoldEvaluator> {
  return Object.fromEntries(
    plan.evaluators.map((evaluator) => [
      evaluator.id,
      {
        recordNamed: Boolean(evaluator.dbEvaluatorId),
        fallbackName: evaluator.evaluatorType.split("/").pop() ?? evaluator.id,
        comparison: isComparisonEvaluator(evaluator),
      },
    ]),
  );
}

/** The cell a command names; a plan without it is a defect, not a wait. */
export function getPlanCell({
  plan,
  ordinal,
  phase,
}: {
  plan: ExperimentRunPlan;
  ordinal: number;
  phase: 1 | 2;
}): ExperimentRunPlanCell {
  const cell = plan.cells[ordinal];
  if (!cell || cell.ordinal !== ordinal || cell.phase !== phase) {
    throw new Error(`The run's plan has no phase ${phase} cell at ordinal ${ordinal}`);
  }

  return cell;
}

/** The target as the run pinned it at start, so every cell runs the same prompt or workflow. */
export function pinnedTargetOf({
  target,
  plan,
}: {
  target: TargetConfig;
  plan: ExperimentRunPlan;
}): TargetConfig {
  const prompt = plan.pinned.prompts.find((pin) => pin.targetId === target.id);
  if (prompt) return { ...target, promptVersionNumber: prompt.version };

  const workflow = plan.pinned.workflows.find((pin) => pin.targetId === target.id);
  if (workflow) return { ...target, workflowVersionId: workflow.versionId };

  return target;
}

/** Every target of the run, pinned. */
export function pinnedTargetsOf(plan: ExperimentRunPlan): TargetConfig[] {
  return plan.targets.map((target) => pinnedTargetOf({ target, plan }));
}

/** A phase-1 cell as the executors take it: its row, its pinned target, its evaluators in order. */
export function targetCellOf({
  plan,
  cell,
}: {
  plan: ExperimentRunPlan;
  cell: ExperimentRunTargetCell;
}): ExecutionCell {
  const target = plan.targets.find((candidate) => candidate.id === cell.targetId);
  const row = plan.rows.find((candidate) => candidate.rowIndex === cell.rowIndex);
  if (!target || !row) {
    throw new Error(`The run's plan has no target or row for cell ${cell.ordinal}`);
  }

  return {
    rowIndex: cell.rowIndex,
    targetId: cell.targetId,
    targetConfig: pinnedTargetOf({ target, plan }),
    evaluatorConfigs: cell.evaluatorIds.flatMap((id) =>
      plan.evaluators.filter((evaluator) => evaluator.id === id),
    ),
    datasetEntry: { _datasetId: plan.mappingDatasetId, ...row.entry },
    ...(cell.skipTarget !== undefined ? { skipTarget: cell.skipTarget } : {}),
    ...(cell.precomputedTargetOutput !== undefined
      ? { precomputedTargetOutput: cell.precomputedTargetOutput }
      : {}),
    ...(cell.traceId !== undefined ? { traceId: cell.traceId } : {}),
  };
}

/** The slice of workbench state the comparison planner reads, rebuilt from the plan. */
export function comparisonStateOf(
  plan: ExperimentRunPlan,
): Pick<EvaluationsV3State, "datasets" | "activeDatasetId" | "targets" | "evaluators"> {
  return {
    datasets: [],
    activeDatasetId: plan.mappingDatasetId,
    targets: pinnedTargetsOf(plan),
    evaluators: plan.evaluators,
  };
}

/** The run's rows at their dataset indices; rows outside the run's scope stay holes. */
export function planDatasetRows(plan: ExperimentRunPlan): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const row of plan.rows) {
    rows[row.rowIndex] = row.entry;
  }

  return rows;
}

/** Every variant output a comparison may read: the seeds the run started with, then its own. */
export function completedTargetOutputsOf({
  plan,
  progress,
}: {
  plan: ExperimentRunPlan;
  progress: ExperimentRunProgressState;
}): Map<string, ExperimentRunTargetOutput> {
  return new Map([
    ...Object.entries(plan.seedTargetOutputs ?? {}),
    ...Object.entries(progress.targetOutputs),
  ]);
}

/** Each variant's verdicts in the run's evaluator order, as the phase-1 cells produced them. */
export function completedEvaluatorScoresOf({
  plan,
  progress,
}: {
  plan: ExperimentRunPlan;
  progress: ExperimentRunProgressState;
}): Map<string, ExperimentRunEvaluatorScore[]> {
  const scores = new Map<string, ExperimentRunEvaluatorScore[]>();
  for (const [key, byEvaluator] of Object.entries(progress.evaluatorScores)) {
    scores.set(
      key,
      plan.evaluators.flatMap((evaluator) => {
        const score = byEvaluator[evaluator.id];
        return score ? [score] : [];
      }),
    );
  }

  return scores;
}

/** Whether every target cell's finish, and so every result it appended first, is folded. */
export function isPhaseOneFolded(progress: ExperimentRunProgressState): boolean {
  return (
    countFinished({ bitmap: progress.finishedCells, from: 0, to: progress.phaseOneCells }) ===
    progress.phaseOneCells
  );
}
