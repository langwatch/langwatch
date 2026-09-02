import type { SerializedHandledError } from "@langwatch/handled-error";
import {
  type EvaluationV3Event,
  UNNAMED_FAILURE,
} from "@langwatch/experiment-contract";
import type { EvaluationResults, TargetRowMetadata } from "../types";

/**
 * How a run's events become the cells the workbench shows.
 *
 * Pure: events in, a new `EvaluationResults` out. The browser hook holds the
 * store and the React state; everything about WHICH cell a frame fills, and
 * what it replaces, lives here, so the fold can be run and asserted without a
 * render, a store or a network.
 *
 * Node-safe by construction — no React, no zustand, no browser globals at
 * import time.
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
 *
 * Every evaluator attached to the workbench is marked running for the cell in
 * the same step: they start the moment the output exists, and each one clears
 * itself when its own result arrives.
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
 *
 * Stores the failure, not the sentence: the engine's raw string in `errors` and
 * the failure's CODE beside it in `targetMetadata`. The cell derives its copy
 * from the code at render time (`describeCellFailure`), so rewriting an error's
 * copy changes what every past run says.
 *
 * The cell stays in `executingCells`; the run's cleanup is what removes it, so
 * a concurrent run's cells are left alone.
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
 *
 * The write is unconditional, which is what a comparison re-run depends on: a
 * `MissingVariantOutput` row from a scoped run replaces the verdict that was
 * there, rather than being dropped because a value already existed.
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
 *
 * Injected rather than computed here: the copy comes from the client error
 * registry, which is a presentation concern and a browser module. The default
 * keeps the fold usable on its own.
 */
export type CellErrorDescriber = (
  event: Extract<EvaluationV3Event, { type: "error" }>,
) => string;

const defaultCellErrorDescriber: CellErrorDescriber = (event) =>
  event.rowIndex === undefined
    ? "The evaluation couldn't be completed"
    : "This row couldn't be run";

/**
 * The evaluator row an `error` frame writes when it names an evaluator.
 *
 * Mirrors the backend fold (`@langwatch/experiment-contract`'s
 * `workbench/execution/run-results.ts`),
 * so a browser run and a polled run leave the same cell behind.
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
 *
 * A frame naming no cell is the whole run failing, and the run's own status
 * already carries that, so the cells are returned untouched.
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
 *
 * Frames that carry no cell (`cell_started`, the fatal `error` with no row) are
 * returned unchanged: they belong to the run's own status, which the caller
 * owns. `stopped` and `done` set the status the run ended with.
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
