import type { DatasetReference, EvaluationResults } from "../types";
import { computeTargetAggregates } from "../utils/computeAggregates";
import type { WorkbenchState } from "./transforms";

/**
 * A compact, serializable view of the workbench, for an agent reading the
 * board before it acts.
 *
 * Everything a decision needs is here — which datasets exist and what their
 * columns are called, which targets run against them and how they are wired,
 * which evaluators grade them, and how the last run went. Everything a decision
 * does not need is left out: full dataset rows, per-row outputs, per-row
 * evaluator results, drawer and selection state.
 */

/** Serialized size the projection stays under. */
export const PROJECTION_BUDGET_BYTES = 32 * 1024;

/** Characters of one sampled cell that survive the projection. */
export const SAMPLE_CELL_MAX_CHARS = 200;

/** Rows sampled per dataset. */
export const SAMPLE_ROWS = 3;

export type ProjectedDataset = {
  id: string;
  name: string;
  type: "inline" | "saved";
  columns: { id: string; name: string; type: string }[];
  rowCount: number;
  sampleRows?: Record<string, string>[];
};

export type ProjectedTarget = {
  id: string;
  type: string;
  promptId?: string;
  promptVersionNumber?: number;
  /** True when the target runs an unsaved prompt draft. */
  hasDraft: boolean;
  model?: string;
  inputs: string[];
  outputs: string[];
  mappings?: Record<string, Record<string, unknown>>;
  /** Replaces `mappings` once the projection has to shrink. */
  mappingCount?: number;
};

export type ProjectedEvaluator = {
  id: string;
  evaluatorType: string;
  dbEvaluatorId?: string;
  inputs: string[];
  mappings?: Record<string, Record<string, Record<string, unknown>>>;
  mappingCount?: number;
};

export type ProjectedTargetResults = {
  targetId: string;
  completedRows: number;
  errorRows: number;
  overallPassRate: number | null;
  overallAverageScore: number | null;
  averageCost: number | null;
  totalCost: number | null;
  averageLatency: number | null;
};

export type ProjectedResults = {
  runId?: string;
  status: string;
  targets: ProjectedTargetResults[];
};

export type ProjectedWorkbenchState = {
  name: string;
  activeDatasetId: string;
  datasets: ProjectedDataset[];
  targets: ProjectedTarget[];
  evaluators: ProjectedEvaluator[];
  results?: ProjectedResults;
  /** Set when the projection dropped detail to fit the size budget. */
  truncated?: boolean;
};

const datasetRowCount = (dataset: DatasetReference): number => {
  if (dataset.type === "inline" && dataset.inline) {
    const columnValues = Object.values(dataset.inline.records);
    if (columnValues.length === 0) return 0;
    return Math.max(...columnValues.map((v) => v.length));
  }
  return dataset.savedRecords?.length ?? 0;
};

const truncateCell = (value: unknown): string => {
  const text =
    typeof value === "string" ? value : value == null ? "" : String(value);
  return text.length > SAMPLE_CELL_MAX_CHARS
    ? `${text.slice(0, SAMPLE_CELL_MAX_CHARS)}…`
    : text;
};

const sampleRowsOf = (dataset: DatasetReference): Record<string, string>[] => {
  const rowCount = Math.min(datasetRowCount(dataset), SAMPLE_ROWS);
  const rows: Record<string, string>[] = [];
  for (let index = 0; index < rowCount; index++) {
    const row: Record<string, string> = {};
    for (const column of dataset.columns) {
      const value =
        dataset.type === "inline"
          ? dataset.inline?.records[column.id]?.[index]
          : dataset.savedRecords?.[index]?.[column.name];
      row[column.name] = truncateCell(value);
    }
    rows.push(row);
  }
  return rows;
};

const countTargetMappings = (
  mappings: Record<string, Record<string, unknown>>,
): number =>
  Object.values(mappings).reduce(
    (sum, byField) => sum + Object.keys(byField).length,
    0,
  );

const countEvaluatorMappings = (
  mappings: Record<string, Record<string, Record<string, unknown>>>,
): number =>
  Object.values(mappings).reduce(
    (sum, byTarget) => sum + countTargetMappings(byTarget),
    0,
  );

const serializedSize = (projection: ProjectedWorkbenchState): number =>
  JSON.stringify(projection).length;

/**
 * Project the workbench for an agent.
 *
 * Pass `results` to include a per-target summary of the last run; without it
 * the projection is state only. The output is capped at
 * `PROJECTION_BUDGET_BYTES`: sample rows go first, then mappings collapse to
 * counts, and `truncated` says so either way.
 */
export const projectWorkbenchState = ({
  state,
  results,
}: {
  state: WorkbenchState;
  results?: EvaluationResults;
}): ProjectedWorkbenchState => {
  const activeDataset =
    state.datasets.find((d) => d.id === state.activeDatasetId) ??
    state.datasets[0];
  const activeRowCount = activeDataset ? datasetRowCount(activeDataset) : 0;

  const projection: ProjectedWorkbenchState = {
    name: state.name,
    activeDatasetId: state.activeDatasetId,
    datasets: state.datasets.map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      type: dataset.type,
      columns: dataset.columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
      })),
      rowCount: datasetRowCount(dataset),
      sampleRows: sampleRowsOf(dataset),
    })),
    targets: state.targets.map((target) => ({
      id: target.id,
      type: target.type,
      promptId: target.promptId,
      promptVersionNumber: target.promptVersionNumber,
      hasDraft: !!target.localPromptConfig,
      model: target.localPromptConfig?.llm.model,
      inputs: (target.inputs ?? []).map((input) => input.identifier),
      outputs: (target.outputs ?? []).map((output) => output.identifier),
      mappings: target.mappings,
    })),
    evaluators: state.evaluators.map((evaluator) => ({
      id: evaluator.id,
      evaluatorType: evaluator.evaluatorType,
      dbEvaluatorId: evaluator.dbEvaluatorId,
      inputs: evaluator.inputs.map((input) => input.identifier),
      mappings: evaluator.mappings,
    })),
  };

  if (results) {
    projection.results = {
      runId: results.runId,
      status: results.status,
      targets: state.targets.map((target) => {
        const aggregate = computeTargetAggregates(
          target.id,
          results,
          state.evaluators,
          activeRowCount,
        );
        return {
          targetId: target.id,
          completedRows: aggregate.completedRows,
          errorRows: aggregate.errorRows,
          overallPassRate: aggregate.overallPassRate,
          overallAverageScore: aggregate.overallAverageScore,
          averageCost: aggregate.averageCost,
          totalCost: aggregate.totalCost,
          averageLatency: aggregate.averageLatency,
        };
      }),
    };
  }

  if (serializedSize(projection) <= PROJECTION_BUDGET_BYTES) {
    return projection;
  }

  // Sample rows are the first to go: they are the only free-text payload here,
  // and an agent can always read a dataset row by row when it needs one.
  projection.truncated = true;
  for (const dataset of projection.datasets) {
    dataset.sampleRows = undefined;
  }
  if (serializedSize(projection) <= PROJECTION_BUDGET_BYTES) {
    return projection;
  }

  // Then mappings collapse to counts. What survives is "this target is wired,
  // and how much of it" — enough to decide whether to ask for the detail.
  for (const target of projection.targets) {
    target.mappingCount = countTargetMappings(target.mappings ?? {});
    target.mappings = undefined;
  }
  for (const evaluator of projection.evaluators) {
    evaluator.mappingCount = countEvaluatorMappings(evaluator.mappings ?? {});
    evaluator.mappings = undefined;
  }

  return projection;
};
