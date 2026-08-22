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
  | { mode: "merge"; keepTargetCells: boolean; evaluatorId?: string };

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

    default:
      return;
  }
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
      keepTargetCells: true,
      evaluatorId: scope.evaluatorId,
    };
  }
  return { mode: "merge", keepTargetCells: false };
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
  if (!plan.keepTargetCells) {
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
