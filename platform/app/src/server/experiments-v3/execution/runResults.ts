/**
 * The cells a run produced, in the shape the workbench persists.
 *
 * A run started with no browser attached streams the same orchestrator events
 * a browser run does, so the fold here mirrors the browser's SSE handler
 * (`experiments-v3/hooks/useExecuteEvaluation.ts`) event for event. The merge
 * mirrors what that handler does to the store before a scoped run: the cells
 * the run covers are cleared and refilled, every other cell stays as it was.
 */

import type { TargetRowMetadata } from "~/experiments-v3/types";
import type { PersistedResults } from "~/experiments-v3/types/persistence";
import {
  type CarriedOverCell,
  type EvaluationV3Event,
  type ExecutionScope,
  UNNAMED_FAILURE,
} from "./types";

/** Cells the run covered, and what each one produced. */
export interface RunResultsDraft {
  runId?: string;
  /** `${rowIndex}:${targetId}` for every cell the run started. */
  startedCells: Set<string>;
  targetOutputs: Record<string, unknown[]>;
  targetMetadata: Record<string, Array<TargetRowMetadata | null | undefined>>;
  evaluatorResults: Record<string, Record<string, unknown[]>>;
  errors: Record<string, Array<string | null | undefined>>;
}

/**
 * How a run's cells fold into the ones already saved.
 *
 * `replace` for a full run, which covers every cell. `merge` for anything
 * narrower: only the cells the run started are cleared, and an evaluator-only
 * run keeps the target outputs it reused and touches one evaluator's column.
 */
export type RunMergePlan =
  | { mode: "replace" }
  | { mode: "merge"; shouldKeepTargetCells: boolean; evaluatorId?: string };

type MergePlan = Extract<RunMergePlan, { mode: "merge" }>;

const cellKey = ({
  rowIndex,
  targetId,
}: {
  rowIndex: number;
  targetId: string;
}): string => `${rowIndex}:${targetId}`;

const parseCellKey = (
  key: string,
): { rowIndex: number; targetId: string } | null => {
  const separator = key.indexOf(":");
  if (separator < 0) return null;
  const rowIndex = Number(key.slice(0, separator));
  if (!Number.isInteger(rowIndex)) return null;
  return { rowIndex, targetId: key.slice(separator + 1) };
};

const rowsOf = <T>(record: Record<string, T[]>, key: string): T[] => {
  const existing = record[key];
  if (existing) return existing;
  const created: T[] = [];
  record[key] = created;
  return created;
};

export const emptyRunResultsDraft = (): RunResultsDraft => ({
  startedCells: new Set<string>(),
  targetOutputs: {},
  targetMetadata: {},
  evaluatorResults: {},
  errors: {},
});

/**
 * Folds one run event into the draft, in place.
 *
 * The draft belongs to a single run, so folding in place keeps a run of a few
 * thousand cells from copying every row array once per event.
 */
export const applyRunEvent = ({
  draft,
  event,
}: {
  draft: RunResultsDraft;
  event: EvaluationV3Event;
}): void => {
  switch (event.type) {
    case "execution_started":
      draft.runId = event.runId;
      return;

    case "cell_started":
      draft.startedCells.add(cellKey(event));
      return;

    case "target_result":
      draft.startedCells.add(cellKey(event));
      applyTargetResult({ draft, event });
      return;

    case "evaluator_result": {
      draft.startedCells.add(cellKey(event));
      const byEvaluator = draft.evaluatorResults[event.targetId] ?? {};
      draft.evaluatorResults[event.targetId] = byEvaluator;
      rowsOf(byEvaluator, event.evaluatorId)[event.rowIndex] = event.result;
      return;
    }

    case "error":
      applyCellError({ draft, event });
      return;

    default:
      return;
  }
};

/**
 * A cell that failed rather than answered. The engine reports it as its own
 * event instead of a result, and the cell still has to show the failure: a run
 * where everything failed writes those failures back, the same as the browser
 * does, rather than leaving the table reading "No output yet".
 *
 * An error naming no cell is the whole run failing. There is no cell to mark,
 * and the run's own status already carries it.
 */
const applyCellError = ({
  draft,
  event,
}: {
  draft: RunResultsDraft;
  event: Extract<EvaluationV3Event, { type: "error" }>;
}): void => {
  const { rowIndex, targetId } = event;
  if (rowIndex === undefined || !targetId) return;

  draft.startedCells.add(cellKey({ rowIndex, targetId }));

  if (event.evaluatorId) {
    const byEvaluator = draft.evaluatorResults[targetId] ?? {};
    draft.evaluatorResults[targetId] = byEvaluator;
    rowsOf(byEvaluator, event.evaluatorId)[rowIndex] = {
      status: "error",
      error_type: "EvaluatorError",
      details: event.message,
      traceback: [],
      ...(event.domainError ? { domainError: event.domainError } : {}),
    };
    return;
  }

  rowsOf(draft.errors, targetId)[rowIndex] = event.message;
  const metadata = rowsOf(draft.targetMetadata, targetId);
  metadata[rowIndex] = {
    ...(metadata[rowIndex] ?? {}),
    ...(event.domainError ? { domainError: event.domainError } : {}),
  };
};

const applyTargetResult = ({
  draft,
  event,
}: {
  draft: RunResultsDraft;
  event: Extract<EvaluationV3Event, { type: "target_result" }>;
}): void => {
  const metadata = rowsOf(draft.targetMetadata, event.targetId);

  if (event.domainError ?? event.error) {
    // The failure, not the sentence: the engine's raw string in `errors` and
    // the failure's code beside it, exactly as a browser run stores it. The
    // cell derives what the customer reads from the code.
    rowsOf(draft.errors, event.targetId)[event.rowIndex] =
      event.error ?? UNNAMED_FAILURE;
    metadata[event.rowIndex] = {
      ...(metadata[event.rowIndex] ?? {}),
      ...(event.domainError ? { domainError: event.domainError } : {}),
    };
    return;
  }

  rowsOf(draft.targetOutputs, event.targetId)[event.rowIndex] = event.output;
  metadata[event.rowIndex] = {
    ...(event.cost !== undefined ? { cost: event.cost } : {}),
    ...(event.duration !== undefined ? { duration: event.duration } : {}),
    ...(event.traceId !== undefined ? { traceId: event.traceId } : {}),
  };
};

/** True when the run produced nothing worth writing back. */
export const runResultsAreEmpty = (draft: RunResultsDraft): boolean =>
  Object.keys(draft.targetOutputs).length === 0 &&
  Object.keys(draft.targetMetadata).length === 0 &&
  Object.keys(draft.evaluatorResults).length === 0 &&
  Object.keys(draft.errors).length === 0;

/**
 * The merge the workbench store applies before it dispatches this scope, read
 * off the scope alone so the browser path and the backend path cannot disagree
 * about what a scoped run replaces.
 */
export const planRunMerge = (scope: ExecutionScope): RunMergePlan => {
  if (scope.type === "full") return { mode: "replace" };
  if (scope.type === "evaluator" || scope.type === "evaluator-all-rows") {
    return {
      mode: "merge",
      shouldKeepTargetCells: true,
      evaluatorId: scope.evaluatorId,
    };
  }
  return { mode: "merge", shouldKeepTargetCells: false };
};

const cloneRows = <T>(rows: Record<string, T[]> | undefined) => {
  const copy: Record<string, T[]> = {};
  for (const [key, values] of Object.entries(rows ?? {})) {
    copy[key] = [...values];
  }
  return copy;
};

const cloneEvaluatorRows = (
  rows: Record<string, Record<string, unknown[]>> | undefined,
) => {
  const copy: Record<string, Record<string, unknown[]>> = {};
  for (const [targetId, byEvaluator] of Object.entries(rows ?? {})) {
    copy[targetId] = cloneRows(byEvaluator);
  }
  return copy;
};

/**
 * Writes the rows the draft actually filled over the ones already there.
 *
 * Only the row indexes the run filled are copied: a row array is sparse by
 * design, and a run of two rows must not blank the rest of the column.
 */
const overlayRows = <T>(
  into: Record<string, T[]>,
  from: Record<string, T[]>,
): void => {
  for (const [key, rows] of Object.entries(from)) {
    const target = rowsOf(into, key);
    for (const index of Object.keys(rows)) {
      const at = Number(index);
      target[at] = rows[at] as T;
    }
  }
};

const clearRow = <T>(
  record: Record<string, Array<T | undefined>>,
  key: string,
  rowIndex: number,
): void => {
  const rows = record[key];
  if (!rows || rowIndex >= rows.length) return;
  rows[rowIndex] = undefined;
};

/**
 * Empties the cells the run covered, so a cell that produced nothing this time
 * reads as empty rather than keeping what a previous run left there.
 */
const clearCoveredCells = ({
  merged,
  draft,
  plan,
}: {
  merged: PersistedResults;
  draft: RunResultsDraft;
  plan: MergePlan;
}): void => {
  for (const key of draft.startedCells) {
    const cell = parseCellKey(key);
    if (!cell) continue;
    clearCoveredCell({ merged, plan, ...cell });
  }
};

const clearCoveredCell = ({
  merged,
  plan,
  rowIndex,
  targetId,
}: {
  merged: PersistedResults;
  plan: MergePlan;
  rowIndex: number;
  targetId: string;
}): void => {
  if (!plan.shouldKeepTargetCells) {
    clearRow(merged.targetOutputs, targetId, rowIndex);
    clearRow(merged.targetMetadata, targetId, rowIndex);
    clearRow(merged.errors, targetId, rowIndex);
  }

  const byEvaluator = merged.evaluatorResults[targetId];
  if (!byEvaluator) return;
  for (const evaluatorId of Object.keys(byEvaluator)) {
    if (plan.evaluatorId && evaluatorId !== plan.evaluatorId) continue;
    clearRow(byEvaluator, evaluatorId, rowIndex);
  }
};

/**
 * The board's cells, minus the ones the run covers, as the run carries them.
 *
 * Reads the same four groups `mergeRunResults` writes, so there is one
 * interpretation of the saved shape rather than two that can drift: a target's
 * output, its metadata, its failure, and its verdicts, each a sparse array
 * indexed by row.
 *
 * A cell with nothing on the board is not carried. Copying an empty cell would
 * write a row saying the target produced nothing, which reads as a result.
 */
export const carriedOverCells = ({
  results,
  coveredCells,
}: {
  results?: PersistedResults;
  /** `${rowIndex}:${targetId}` for every cell the run itself covers. */
  coveredCells: ReadonlySet<string>;
}): CarriedOverCell[] => {
  if (!results) return [];

  const cells = new Map<string, CarriedOverCell>();

  const cellAt = ({
    rowIndex,
    targetId,
  }: {
    rowIndex: number;
    targetId: string;
  }): CarriedOverCell | null => {
    const key = cellKey({ rowIndex, targetId });
    if (coveredCells.has(key)) return null;
    const existing = cells.get(key);
    if (existing) return existing;
    const created: CarriedOverCell = {
      rowIndex,
      targetId,
      evaluatorResults: [],
    };
    cells.set(key, created);
    return created;
  };

  for (const [targetId, outputs] of Object.entries(results.targetOutputs)) {
    outputs.forEach((output, rowIndex) => {
      if (output === undefined || output === null) return;
      const cell = cellAt({ rowIndex, targetId });
      if (cell) cell.output = output;
    });
  }

  for (const [targetId, errors] of Object.entries(results.errors)) {
    errors.forEach((error, rowIndex) => {
      if (!error) return;
      const cell = cellAt({ rowIndex, targetId });
      if (cell) cell.error = error;
    });
  }

  for (const [targetId, byEvaluator] of Object.entries(
    results.evaluatorResults,
  )) {
    for (const [evaluatorId, verdicts] of Object.entries(byEvaluator)) {
      verdicts.forEach((result, rowIndex) => {
        if (result === undefined || result === null) return;
        const cell = cellAt({ rowIndex, targetId });
        if (cell) cell.evaluatorResults.push({ evaluatorId, result });
      });
    }
  }

  // Metadata last, and only onto cells something else already opened. A row
  // holding cost but neither an output nor a failure is a leftover, not a
  // result, and carrying it would draw an empty cell with a price on it.
  for (const [targetId, metadata] of Object.entries(results.targetMetadata)) {
    metadata.forEach((entry, rowIndex) => {
      if (!entry) return;
      const cell = cells.get(cellKey({ rowIndex, targetId }));
      if (!cell) return;
      if (entry.cost !== undefined) cell.cost = entry.cost;
      if (entry.duration !== undefined) cell.duration = entry.duration;
      if (entry.traceId !== undefined) cell.traceId = entry.traceId;
      if (entry.domainError !== undefined) cell.domainError = entry.domainError;
    });
  }

  return [...cells.values()];
};

export const mergeRunResults = ({
  existing,
  draft,
  plan,
}: {
  existing?: PersistedResults;
  draft: RunResultsDraft;
  plan: RunMergePlan;
}): PersistedResults => {
  const runId = draft.runId ?? existing?.runId;
  const identity = {
    ...(runId !== undefined ? { runId } : {}),
    ...(existing?.versionId !== undefined
      ? { versionId: existing.versionId }
      : {}),
  };

  if (plan.mode === "replace") {
    return {
      ...identity,
      targetOutputs: draft.targetOutputs,
      targetMetadata: draft.targetMetadata,
      evaluatorResults: draft.evaluatorResults,
      errors: draft.errors,
    };
  }

  const merged: PersistedResults = {
    ...identity,
    targetOutputs: cloneRows(existing?.targetOutputs),
    targetMetadata: cloneRows(existing?.targetMetadata),
    evaluatorResults: cloneEvaluatorRows(existing?.evaluatorResults),
    errors: cloneRows(existing?.errors),
  };

  clearCoveredCells({ merged, draft, plan });

  overlayRows(merged.targetOutputs, draft.targetOutputs);
  overlayRows(merged.targetMetadata, draft.targetMetadata);
  overlayRows(merged.errors, draft.errors);
  for (const [targetId, byEvaluator] of Object.entries(
    draft.evaluatorResults,
  )) {
    const target = merged.evaluatorResults[targetId] ?? {};
    merged.evaluatorResults[targetId] = target;
    overlayRows(target, byEvaluator);
  }

  return merged;
};
