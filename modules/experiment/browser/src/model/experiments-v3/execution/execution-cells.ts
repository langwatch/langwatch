/**
 * Pure changes to the workbench results around one execution: what a partial
 * run clears before it starts, and what it hands back when it ends.
 */
import type { CellId, ExecutionScope } from "@langwatch/experiment-contract";

import type { EvaluationResults } from "../types.ts";

type CellArrays<T> = Record<string, (T | undefined | null)[]>;

/** One cell of an array-backed record emptied, leaving the record as is when it held nothing. */
const withoutCell = <T>({
  record,
  targetId,
  rowIndex,
}: {
  record: CellArrays<T>;
  targetId: string;
  rowIndex: number;
}): CellArrays<T> => {
  const values = record[targetId];
  if (!values || values[rowIndex] === undefined) return record;
  const next = [...values];
  next[rowIndex] = undefined;
  return { ...record, [targetId]: next };
};

const isEvaluatorOnly = (scope: ExecutionScope): boolean =>
  scope.type === "evaluator-all-rows" || scope.type === "evaluator";

/**
 * One target's evaluator results for a cell about to run: an evaluator-only
 * scope marks its evaluator running (even one with no results yet); any other
 * scope empties every evaluator's slot.
 */
const evaluatorResultsForCell = ({
  targetResults,
  evaluatorIds,
  rowIndex,
  evaluatorOnly,
}: {
  targetResults: Record<string, unknown[]>;
  evaluatorIds: string[];
  rowIndex: number;
  evaluatorOnly: boolean;
}): Record<string, unknown[]> => {
  const next = { ...targetResults };
  for (const evaluatorId of evaluatorIds) {
    const current = next[evaluatorId];
    if (evaluatorOnly) {
      const running = current ? [...current] : [];
      running[rowIndex] = { status: "running" };
      next[evaluatorId] = running;
    } else if (current && current[rowIndex] !== undefined) {
      const cleared = [...current];
      cleared[rowIndex] = undefined;
      next[evaluatorId] = cleared;
    }
  }
  return next;
};

/**
 * The results a partial run starts from: its cells marked executing, their
 * target outputs cleared (unless it only re-runs evaluators, which reuse them),
 * and their evaluator results cleared or marked running.
 */
export const resultsBeforePartialRun = ({
  results,
  evaluatorIds,
  scope,
  executionCells,
  executingCells,
}: {
  results: EvaluationResults;
  evaluatorIds: string[];
  scope: ExecutionScope;
  executionCells: CellId[];
  executingCells: Set<string>;
}): EvaluationResults => {
  const evaluatorOnly = isEvaluatorOnly(scope);
  const idsToClear =
    evaluatorOnly && "evaluatorId" in scope && scope.evaluatorId
      ? [scope.evaluatorId]
      : evaluatorIds;
  let targetOutputs = { ...results.targetOutputs };
  let targetMetadata = { ...results.targetMetadata };
  let errors = { ...results.errors };
  const evaluatorResults = { ...results.evaluatorResults };

  for (const { targetId, rowIndex } of executionCells) {
    if (!evaluatorOnly) {
      targetOutputs = withoutCell({ record: targetOutputs, targetId, rowIndex });
      targetMetadata = withoutCell({ record: targetMetadata, targetId, rowIndex });
      errors = withoutCell({ record: errors, targetId, rowIndex });
    }
    evaluatorResults[targetId] = evaluatorResultsForCell({
      targetResults: evaluatorResults[targetId] ?? {},
      evaluatorIds: idsToClear,
      rowIndex,
      evaluatorOnly,
    });
  }

  return {
    ...results,
    status: "running",
    executingCells: results.executingCells
      ? new Set([...results.executingCells, ...executingCells])
      : executingCells,
    targetOutputs,
    targetMetadata,
    errors,
    evaluatorResults,
  };
};

const nonEmpty = (set: Set<string>): Set<string> | undefined => (set.size > 0 ? set : undefined);

/**
 * The results once this execution ends: only its own cells and running evaluators
 * ("rowIndex:targetId:evaluatorId") leave the executing sets, so concurrent runs keep
 * theirs. The status becomes "success" unless other work remains or the run stopped.
 */
export const resultsAfterRun = ({
  results,
  executingCells,
}: {
  results: EvaluationResults;
  executingCells: Set<string>;
}): EvaluationResults => {
  const remainingCells = results.executingCells
    ? nonEmpty(new Set([...results.executingCells].filter((key) => !executingCells.has(key))))
    : undefined;
  const remainingEvaluators = results.runningEvaluators
    ? nonEmpty(
        new Set(
          [...results.runningEvaluators].filter((key) => {
            const [rowIndex, targetId] = key.split(":");
            return targetId === undefined || !executingCells.has(`${rowIndex}:${targetId}`);
          }),
        ),
      )
    : undefined;
  const hasRemainingWork = remainingCells !== undefined || remainingEvaluators !== undefined;

  return {
    ...results,
    executingCells: remainingCells,
    runningEvaluators: remainingEvaluators,
    status: hasRemainingWork || results.status === "stopped" ? results.status : "success",
  };
};

/** A target's rows that already produced output, with trace ids, for an evaluator-only run. */
export const producedRowsOf = ({
  targetOutputs,
  targetMetadata,
}: {
  targetOutputs: unknown[];
  targetMetadata: ({ traceId?: string } | undefined | null)[];
}): {
  precomputedTargetOutputs: Record<number, unknown>;
  traceIds: Record<number, string | undefined>;
} => {
  const precomputedTargetOutputs: Record<number, unknown> = {};
  const traceIds: Record<number, string | undefined> = {};
  targetOutputs.forEach((output, index) => {
    if (output === undefined || output === null) return;
    precomputedTargetOutputs[index] = output;
    traceIds[index] = targetMetadata[index]?.traceId;
  });
  return { precomputedTargetOutputs, traceIds };
};
