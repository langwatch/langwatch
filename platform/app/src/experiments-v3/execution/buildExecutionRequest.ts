import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import type {
  ExecutionRequest,
  ExecutionScope,
} from "~/server/experiments-v3/execution/types";
import type {
  DatasetReference,
  EvaluationResults,
  EvaluatorConfig,
  TargetConfig,
} from "../types";
import { type CellId, computeExecutionCells } from "../utils/executionScope";
import { toComparisonConfig } from "../utils/normalizeComparison";

/**
 * The request one workbench run sends, built from state alone.
 *
 * Pure and node-safe: the browser hook and the server-side saved-state runner
 * both go through here, so a run started from an open page and a run started
 * with no page attached cover the same cells and carry the same seeds.
 */

/** Outputs a run reuses instead of producing, keyed `${rowIndex}:${targetId}`. */
export type SeedTargetOutputs = Record<
  string,
  { output: unknown; cost?: number; duration?: number }
>;

/** The saved cells a run reads when it decides what it can reuse. */
export type SeedableResults = Pick<
  EvaluationResults,
  "targetOutputs" | "targetMetadata"
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
  results?: SeedableResults;
};

/**
 * The rows a scope covers, as indexes into the dataset.
 *
 * Mirrors the orchestrator's `resolveScopedRowIndices`: the two must agree, or
 * a run seeds rows it does not cover and leaves the rows it does bare.
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

/**
 * The other columns a comparison needs before it can judge this one.
 *
 * Two carrier shapes reach this, and both leave the same hole in a scoped run:
 *
 *   - a column-style comparison target, whose own `comparison` names the
 *     variants it compares. Running that column alone produces nothing without
 *     them.
 *   - a chip-style comparison evaluator, whose `comparison` names variants that
 *     are plain target columns. Running ONE of those variants alone leaves the
 *     judge with no output for the others, and Phase 2 reports every one of
 *     them as "Waiting on …" over verdicts nobody asked to re-run.
 *
 * The scoped column itself is never returned: it is already in the run.
 */
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
    carriers.flatMap(
      (carrier) => toComparisonConfig(carrier)?.variants?.filter(Boolean) ?? [],
    ),
  );
  dependencies.delete(targetId);
  return [...dependencies];
};

/**
 * What a scoped run does about the columns its comparisons depend on.
 *
 * Row by row: a dependency that already has a saved output is SEEDED, so the
 * judge reads it without paying to produce it again; a dependency with nothing
 * saved is added to the run, so Phase 1 produces what Phase 2 needs. A full run
 * needs neither, because it runs every column anyway.
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
    scoped.flatMap((targetId) =>
      comparisonDependencies({ targets, evaluators, targetId }),
    ),
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

/** The dataset a run evaluates: the active one, or the first one there is. */
export const activeDatasetOf = (
  state: Pick<ExecutionRequestState, "datasets" | "activeDatasetId">,
): DatasetReference | undefined =>
  state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ??
  state.datasets[0];

/** The active dataset's rows, whichever way the dataset stores them. */
export const datasetRowsOf = (
  dataset: DatasetReference,
): Record<string, unknown>[] =>
  dataset.inline?.records
    ? transposeColumnsFirstToRowsFirstWithId(dataset.inline.records)
    : (dataset.savedRecords ?? []);

/**
 * Build the request for one run, plus the cells it will dispatch.
 *
 * `executionCells` is the caller's, not the engine's: the page uses it to mark
 * cells as running and to size its progress bar. The engine plans its own cells
 * from `scope` and `seedTargetOutputs`, and reaches the same set.
 */
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
  const dataset = activeDatasetOf(state);
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
    targets: state.targets.map((target) => ({
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
      // Comparison column-targets need this on the wire so the orchestrator can
      // skip the column in Phase 1 and emit Phase 2 synthetic cells with every
      // variant's output baked in. Without it, the server falls through to a
      // normal evaluator-target dispatch whose mappings have no per-row
      // candidate outputs, and the judge endpoint rejects the empty payload.
      //
      // Normalized rather than passed through: a state loaded from a pre-merge
      // experiment still carries the legacy `pairwise` shape here, and the
      // server only understands `comparison`.
      comparison: toComparisonConfig(target),
    })),
    evaluators: state.evaluators.map((evaluator) => ({
      id: evaluator.id,
      evaluatorType: evaluator.evaluatorType,
      inputs: evaluator.inputs,
      mappings: evaluator.mappings,
      dbEvaluatorId: evaluator.dbEvaluatorId,
      localEvaluatorConfig: evaluator.localEvaluatorConfig,
      // The comparison config must survive the wire. The orchestrator keys its
      // whole Phase-1/Phase-2 split off this field: without it every comparison
      // evaluator looks like a plain per-row evaluator, gets attached to each
      // target cell in Phase 1, and dispatches an empty input payload (nlpgo:
      // "Data required").
      comparison: toComparisonConfig(evaluator),
    })),
    scope,
    ...(concurrency !== undefined ? { concurrency } : {}),
    seedTargetOutputs:
      Object.keys(seedTargetOutputs).length > 0 ? seedTargetOutputs : undefined,
  };

  return { request, executionCells: [...baseCells, ...extraCells] };
};
