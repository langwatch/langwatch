import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";

import type {
  DatasetReference,
  EvaluationResults,
  EvaluatorConfig,
  TargetConfig,
} from "../../experiment-workbench.ts";
import { type CellId, computeExecutionCells } from "../execution-scope.ts";
import { toComparisonConfig } from "../normalize-comparison.ts";
import { carriedOverCells } from "./run-results.ts";
import type { CarriedOverCell, ExecutionRequest, ExecutionScope } from "./types.ts";

/**
 * The request one workbench run sends, built from state alone. Pure and
 * node-safe: the browser hook and the server-side saved-state runner both go
 * through here, so an open-page run and a no-page run cover the same cells.
 */

/** Outputs a run reuses instead of producing, keyed `${rowIndex}:${targetId}`. */
export type SeedTargetOutputs = Record<
  string,
  { output: unknown; cost?: number; duration?: number }
>;

/** The saved cells a run reads when it decides what it can reuse. */
export type SeedableResults = Pick<EvaluationResults, "targetOutputs" | "targetMetadata">;

/** The saved cells a run reads when it carries the board in. */
export type BoardResults = Pick<
  EvaluationResults,
  "targetOutputs" | "targetMetadata" | "evaluatorResults" | "errors"
>;

/** The workbench slice a request is built from. */
export type ExecutionRequestState = {
  name: string;
  datasets: DatasetReference[];
  activeDatasetId: string;
  targets: TargetConfig[];
  evaluators: EvaluatorConfig[];
  experimentId?: string;
  experimentSlug?: string;
  results?: SeedableResults & Partial<BoardResults>;
};

/**
 * The rows a scope covers, as indexes into the dataset. Mirrors the
 * orchestrator's `resolveScopedRowIndices`: the two must agree, or a run
 * seeds rows it does not cover and leaves the rows it does bare.
 */
const rowsInScope = ({
  scope,
  rowCount,
}: {
  scope: ExecutionScope;
  rowCount: number;
}): number[] => {
  const everyRow = () => Array.from({ length: rowCount }, (_, index) => index);
  switch (scope.type) {
    case "rows":
      return scope.rowIndices;
    case "cell":
    case "evaluator":
      return [scope.rowIndex];
    case "target-rows":
      return scope.rowIndices ?? everyRow();
    default:
      return everyRow();
  }
};

/** The targets a scope names, or none when the scope names no column. */
const targetsInScope = (scope: ExecutionScope): string[] => {
  switch (scope.type) {
    case "target":
    case "cell":
      return [scope.targetId];
    case "target-rows":
      return scope.targetIds;
    default:
      return [];
  }
};

// The variant columns a comparison needs before it can judge. Column-style
// comparisons need their variants; chip evaluators need all variants for full
// output.
export const comparisonDependencies = ({
  targets,
  evaluators,
  targetId,
}: {
  targets: TargetConfig[];
  evaluators: Pick<EvaluatorConfig, "comparison" | "pairwise">[];
  targetId: string;
}): string[] => {
  const target = targets.find((candidate) => candidate.id === targetId);
  const carriers = [
    ...(target?.type === "evaluator" ? [target] : []),
    ...evaluators.filter((evaluator) =>
      toComparisonConfig(evaluator)?.variants?.includes(targetId),
    ),
  ];

  const dependencies = new Set(
    carriers.flatMap((carrier) => toComparisonConfig(carrier)?.variants?.filter(Boolean) ?? []),
  );
  dependencies.delete(targetId);
  return [...dependencies];
};

/**
 * What a scoped run does about the columns its comparisons depend on. A
 * dependency already saved is SEEDED so the judge reads it for free; one
 * with nothing saved is added for Phase 1 to produce; a full run needs neither.
 */
export const planComparisonSeeding = ({
  targets,
  evaluators,
  scope,
  rowCount,
  results,
}: {
  targets: TargetConfig[];
  evaluators: Pick<EvaluatorConfig, "comparison" | "pairwise">[];
  scope: ExecutionScope;
  rowCount: number;
  results?: SeedableResults;
}): { seedTargetOutputs: SeedTargetOutputs; extraCells: CellId[] } => {
  const plan: { seedTargetOutputs: SeedTargetOutputs; extraCells: CellId[] } = {
    seedTargetOutputs: {},
    extraCells: [],
  };

  const scoped = targetsInScope(scope);
  if (scoped.length === 0) return plan;

  const rows = rowsInScope({ scope, rowCount });
  const dependencies = new Set(
    scoped.flatMap((targetId) => comparisonDependencies({ targets, evaluators, targetId })),
  );

  for (const dependencyId of dependencies) {
    if (scoped.includes(dependencyId)) continue;
    seedOneDependency({ plan, dependencyId, rows, results });
  }

  return plan;
};

/** Seed or schedule one dependency, row by row. */
const seedOneDependency = ({
  plan,
  dependencyId,
  rows,
  results,
}: {
  plan: { seedTargetOutputs: SeedTargetOutputs; extraCells: CellId[] };
  dependencyId: string;
  rows: number[];
  results?: SeedableResults;
}): void => {
  const outputs = results?.targetOutputs[dependencyId] ?? [];
  const metadata = results?.targetMetadata[dependencyId] ?? [];

  for (const rowIndex of rows) {
    const saved = outputs[rowIndex];
    if (saved === undefined || saved === null) {
      plan.extraCells.push({ rowIndex, targetId: dependencyId });
      continue;
    }
    plan.seedTargetOutputs[`${rowIndex}:${dependencyId}`] = {
      output: saved,
      cost: metadata[rowIndex]?.cost ?? undefined,
      duration: metadata[rowIndex]?.duration ?? undefined,
    };
  }
};

/**
 * The cells a run covers itself, as `${rowIndex}:${targetId}` keys.
 * `computeExecutionCells` covers scopes naming rows/columns; the single-cell
 * `evaluator` scope names neither, so its cell is added here to avoid a stale verdict.
 */
const cellsCoveredByRun = ({
  scope,
  targetIds,
  datasetRows,
  extraCells,
}: {
  scope: ExecutionScope;
  targetIds: string[];
  datasetRows: Record<string, unknown>[];
  extraCells: CellId[];
}): Set<string> => {
  const covered = new Set(
    [...computeExecutionCells({ scope, targetIds, datasetRows }), ...extraCells].map(
      (cell) => `${cell.rowIndex}:${cell.targetId}`,
    ),
  );
  if (scope.type === "evaluator") {
    covered.add(`${scope.rowIndex}:${scope.targetId}`);
  }
  return covered;
};

// Cells a run carries rather than produces. Every cell the run doesn't cover
// is copied from the board as it stood, so opening shows the whole board.
export const planBoardCarryOver = ({
  targets,
  scope,
  datasetRows,
  results,
  extraCells = [],
}: {
  targets: Pick<TargetConfig, "id">[];
  scope: ExecutionScope;
  datasetRows: Record<string, unknown>[];
  results?: Partial<BoardResults>;
  extraCells?: CellId[];
}): CarriedOverCell[] => {
  if (!results) return [];

  return carriedOverCells({
    results: {
      targetOutputs: results.targetOutputs ?? {},
      targetMetadata: results.targetMetadata ?? {},
      evaluatorResults: results.evaluatorResults ?? {},
      errors: results.errors ?? {},
    },
    coveredCells: cellsCoveredByRun({
      scope,
      targetIds: targets.map((target) => target.id),
      datasetRows,
      extraCells,
    }),
  });
};

/** The dataset a run evaluates: the active one, or the first one there is. */
export const pickActiveDataset = (
  state: Pick<ExecutionRequestState, "datasets" | "activeDatasetId">,
): DatasetReference | undefined =>
  state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? state.datasets[0];

/** The active dataset's rows, whichever way the dataset stores them. */
export const datasetRowsOf = (dataset: DatasetReference): Record<string, unknown>[] =>
  dataset.inline?.records
    ? transposeColumnsFirstToRowsFirstWithId(dataset.inline.records)
    : (dataset.savedRecords ?? []);

// executionCells is the caller's: the page marks cells as running and sizes
// progress. Comparison config is normalized: legacy pairwise becomes comparison
// so the orchestrator can handle column-style targets correctly.
const targetOnTheWire = (target: TargetConfig): ExecutionRequest["targets"][number] => ({
  id: target.id,
  type: target.type,
  promptId: target.promptId,
  promptVersionId: target.promptVersionId,
  promptVersionNumber: target.promptVersionNumber,
  dbAgentId: target.dbAgentId,
  agentType: target.agentType,
  httpConfig: target.httpConfig,
  targetEvaluatorId: target.targetEvaluatorId,
  inputs: target.inputs,
  outputs: target.outputs,
  mappings: target.mappings,
  localPromptConfig: target.localPromptConfig,
  localEvaluatorConfig: target.localEvaluatorConfig,
  comparison: toComparisonConfig(target),
});

/**
 * One evaluator as the server reads it. The comparison config must survive
 * the wire: without it, the orchestrator's Phase-1/Phase-2 split breaks and
 * a comparison evaluator dispatches nlpgo an empty payload.
 */
const evaluatorOnTheWire = (
  evaluator: EvaluatorConfig,
): ExecutionRequest["evaluators"][number] => ({
  id: evaluator.id,
  evaluatorType: evaluator.evaluatorType,
  inputs: evaluator.inputs,
  mappings: evaluator.mappings,
  dbEvaluatorId: evaluator.dbEvaluatorId,
  localEvaluatorConfig: evaluator.localEvaluatorConfig,
  comparison: toComparisonConfig(evaluator),
});

export const buildExecutionRequest = ({
  state,
  projectId,
  scope,
  concurrency,
}: {
  state: ExecutionRequestState;
  projectId: string;
  scope: ExecutionScope;
  concurrency?: number;
}): { request: ExecutionRequest; executionCells: CellId[] } | null => {
  const dataset = pickActiveDataset(state);
  if (!dataset) return null;

  const datasetRows = datasetRowsOf(dataset);

  const baseCells = computeExecutionCells({
    scope,
    targetIds: state.targets.map((target) => target.id),
    datasetRows,
  });

  const { seedTargetOutputs, extraCells } = planComparisonSeeding({
    targets: state.targets,
    evaluators: state.evaluators,
    scope,
    rowCount: datasetRows.length,
    results: state.results,
  });

  // The board as it stands, minus what this run is about to produce. The page
  // sends it rather than the server reading the saved state, because the page's
  // board can be ahead of the last autosave and the run must hold what the
  // person is actually looking at.
  const carried = planBoardCarryOver({
    targets: state.targets,
    scope,
    datasetRows,
    results: state.results,
    extraCells,
  });

  const request: ExecutionRequest = {
    projectId,
    experimentId: state.experimentId ?? undefined,
    experimentSlug: state.experimentSlug ?? undefined,
    name: state.name || "Evaluation",
    dataset: {
      id: dataset.id,
      name: dataset.name,
      type: dataset.type ?? "inline",
      inline: dataset.inline,
      datasetId: dataset.datasetId,
      columns: dataset.columns ?? [],
      savedRecords: dataset.savedRecords,
    },
    targets: state.targets.map(targetOnTheWire),
    evaluators: state.evaluators.map(evaluatorOnTheWire),
    scope,
    ...(concurrency !== undefined ? { concurrency } : {}),
    seedTargetOutputs: Object.keys(seedTargetOutputs).length > 0 ? seedTargetOutputs : undefined,
    carriedOverCells: carried.length > 0 ? carried : undefined,
  };

  return { request, executionCells: [...baseCells, ...extraCells] };
};
