import type { SerializedHandledError } from "@langwatch/handled-error";
import { type EvaluationV3Event, UNNAMED_FAILURE } from "@langwatch/experiment-contract";
import type { EvaluationResults, TargetRowMetadata } from "../types";

/**
 * How a run's events become the cells the workbench shows.
 */

/** One evaluator's key inside `runningEvaluators`. */
const evaluatorKey = ({
  rowIndex,
  targetId,
  evaluatorId,
}: {
  rowIndex: number;
  targetId: string;
  evaluatorId: string;
}): string => `${rowIndex}:${targetId}:${evaluatorId}`;

/** One row of one column, written into a copy of the record. */
const withRow = <T>({
  record,
  key,
  rowIndex,
  value,
}: {
  record: Record<string, T[]>;
  key: string;
  rowIndex: number;
  value: T;
}): Record<string, T[]> => {
  const rows = [...(record[key] ?? [])];
  rows[rowIndex] = value;
  return { ...record, [key]: rows };
};

/**
 * A target answered for one row.
 */
export const applyTargetOutput = ({
  results,
  rowIndex,
  targetId,
  output,
  metadata,
  evaluatorIds,
}: {
  results: EvaluationResults;
  rowIndex: number;
  targetId: string;
  output: unknown;
  metadata?: TargetRowMetadata;
  evaluatorIds: string[];
}): EvaluationResults => {
  const runningEvaluators = new Set(results.runningEvaluators ?? []);
  for (const evaluatorId of evaluatorIds) {
    runningEvaluators.add(evaluatorKey({ rowIndex, targetId, evaluatorId }));
  }

  return {
    ...results,
    targetOutputs: withRow({
      record: results.targetOutputs,
      key: targetId,
      rowIndex,
      value: output,
    }),
    // The cell draws its failure before its output, so a retry that succeeds
    // has to take the previous failure off the row or the customer keeps
    // reading an error the run has already corrected.
    errors: withRow({
      record: results.errors,
      key: targetId,
      rowIndex,
      value: null,
    }),
    targetMetadata: metadata
      ? withRow({
          record: results.targetMetadata,
          key: targetId,
          rowIndex,
          value: metadata,
        })
      : results.targetMetadata,
    runningEvaluators,
  };
};

/**
 * A target failed for one row.
 */
export const applyTargetError = ({
  results,
  rowIndex,
  targetId,
  error,
  domainError,
}: {
  results: EvaluationResults;
  rowIndex: number;
  targetId: string;
  error: string;
  domainError?: SerializedHandledError;
}): EvaluationResults => {
  const existingMetadata = results.targetMetadata[targetId]?.[rowIndex] ?? {};

  return {
    ...results,
    errors: withRow({
      record: results.errors,
      key: targetId,
      rowIndex,
      value: error,
    }),
    targetMetadata: withRow({
      record: results.targetMetadata,
      key: targetId,
      rowIndex,
      value: { ...existingMetadata, domainError },
    }),
  };
};

/**
 * An evaluator answered for one row, and stops being reported as running.
 */
export const applyEvaluatorResult = ({
  results,
  rowIndex,
  targetId,
  evaluatorId,
  result,
}: {
  results: EvaluationResults;
  rowIndex: number;
  targetId: string;
  evaluatorId: string;
  result: unknown;
}): EvaluationResults => {
  const byEvaluator = results.evaluatorResults[targetId] ?? {};
  const rows = [...(byEvaluator[evaluatorId] ?? [])];
  rows[rowIndex] = result;

  let runningEvaluators = results.runningEvaluators;
  const key = evaluatorKey({ rowIndex, targetId, evaluatorId });
  if (runningEvaluators?.has(key)) {
    runningEvaluators = new Set(runningEvaluators);
    runningEvaluators.delete(key);
    if (runningEvaluators.size === 0) runningEvaluators = undefined;
  }

  return {
    ...results,
    evaluatorResults: {
      ...results.evaluatorResults,
      [targetId]: { ...byEvaluator, [evaluatorId]: rows },
    },
    runningEvaluators,
  };
};

/**
 * The words a cell-level `error` frame shows.
 */
export type CellErrorDescriber = (event: Extract<EvaluationV3Event, { type: "error" }>) => string;

const defaultCellErrorDescriber: CellErrorDescriber = (event) =>
  event.rowIndex === undefined
    ? "The evaluation couldn't be completed"
    : "This row couldn't be run";

/**
 * The evaluator row an `error` frame writes when it names an evaluator.
 */
const evaluatorErrorRow = ({
  detail,
  domainError,
}: {
  detail: string;
  domainError?: SerializedHandledError;
}) => ({
  status: "error",
  error_type: "EvaluatorError",
  details: detail,
  traceback: [],
  ...(domainError ? { domainError } : {}),
});

/**
 * A cell-level `error` frame, folded into whichever cell it names.
 */
const applyCellErrorEvent = ({
  results,
  event,
  describeCellError,
}: {
  results: EvaluationResults;
  event: Extract<EvaluationV3Event, { type: "error" }>;
  describeCellError: CellErrorDescriber;
}): EvaluationResults => {
  const { rowIndex, targetId, evaluatorId } = event;
  if (rowIndex === undefined || !targetId) return results;

  if (evaluatorId) {
    return applyEvaluatorResult({
      results,
      rowIndex,
      targetId,
      evaluatorId,
      result: evaluatorErrorRow({
        detail: describeCellError(event),
        domainError: event.domainError,
      }),
    });
  }

  return applyTargetError({
    results,
    rowIndex,
    targetId,
    error: event.message,
    domainError: event.domainError,
  });
};

/** A target frame, folded into its cell as an output or as a failure. */
const applyTargetResultEvent = ({
  results,
  event,
  evaluatorIds,
}: {
  results: EvaluationResults;
  event: Extract<EvaluationV3Event, { type: "target_result" }>;
  evaluatorIds: string[];
}): EvaluationResults => {
  if (event.domainError ?? event.error) {
    return applyTargetError({
      results,
      rowIndex: event.rowIndex,
      targetId: event.targetId,
      error: event.error ?? UNNAMED_FAILURE,
      domainError: event.domainError,
    });
  }
  return applyTargetOutput({
    results,
    rowIndex: event.rowIndex,
    targetId: event.targetId,
    output: event.output,
    metadata: {
      ...(event.cost !== undefined ? { cost: event.cost } : {}),
      ...(event.duration !== undefined ? { duration: event.duration } : {}),
      ...(event.traceId !== undefined ? { traceId: event.traceId } : {}),
    },
    evaluatorIds,
  });
};

/**
 * Fold one run event into the results.
 */
export const foldEvaluationEvent = ({
  results,
  event,
  evaluatorIds,
  describeCellError = defaultCellErrorDescriber,
}: {
  results: EvaluationResults;
  event: EvaluationV3Event;
  evaluatorIds: string[];
  describeCellError?: CellErrorDescriber;
}): EvaluationResults => {
  switch (event.type) {
    case "execution_started":
      return {
        ...results,
        runId: event.runId,
        status: "running",
        progress: 0,
        total: event.total,
      };

    case "target_result":
      return applyTargetResultEvent({ results, event, evaluatorIds });

    case "evaluator_result":
      return applyEvaluatorResult({
        results,
        rowIndex: event.rowIndex,
        targetId: event.targetId,
        evaluatorId: event.evaluatorId,
        result: event.result,
      });

    case "progress":
      return { ...results, progress: event.completed, total: event.total };

    case "error":
      return applyCellErrorEvent({ results, event, describeCellError });

    case "stopped":
      return { ...results, status: "stopped" };

    case "done":
      return { ...results, status: "success" };

    default:
      return results;
  }
};

/** Fold a whole stream, oldest frame first. */
export const foldEvaluationEvents = ({
  results,
  events,
  evaluatorIds,
  describeCellError,
}: {
  results: EvaluationResults;
  events: EvaluationV3Event[];
  evaluatorIds: string[];
  describeCellError?: CellErrorDescriber;
}): EvaluationResults =>
  events.reduce(
    (folded, event) =>
      foldEvaluationEvent({
        results: folded,
        event,
        evaluatorIds,
        describeCellError,
      }),
    results,
  );
