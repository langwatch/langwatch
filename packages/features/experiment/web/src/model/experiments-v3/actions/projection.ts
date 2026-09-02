import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import type {
  ComparisonEvaluatorConfig,
  DatasetReference,
  EvaluationResults,
} from "../types";
import { computeTargetAggregates } from "../compute-aggregates";
import { toComparisonConfig } from "../normalize-comparison";
import { disambiguateNames } from "../variant-disambiguation";
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

/** UTF-8 size of the serialized projection, which the output never exceeds. */
export const PROJECTION_BUDGET_BYTES = 32 * 1024;

/** Characters of one sampled cell that survive the projection. */
export const SAMPLE_CELL_MAX_CHARS = 200;

/** Rows sampled per dataset. */
export const SAMPLE_ROWS = 3;

/** Distinct failure kinds reported per column. */
export const ERROR_SAMPLE_LIMIT = 3;

/** Characters of one sampled failure that survive the projection. */
export const ERROR_SAMPLE_MAX_CHARS = 80;

export type ProjectedDataset = {
  id: string;
  name: string;
  type: "inline" | "saved";
  columns: { id: string; name: string; type: string }[];
  rowCount: number;
  sampleRows?: Record<string, string>[];
};

/**
 * A comparison, as the board shows it: which columns it judges and what it
 * judges them against.
 *
 * `variantNames` carries the same "(1)" / "(2)" suffixes a run's own errors
 * use, so "Waiting on category_classifier (1)" names a column the reader can
 * find here rather than one of two identically named ones.
 */
export type ProjectedComparison = {
  variants: string[];
  variantNames: string[];
  hasGoldenAnswer: boolean;
  goldenField?: string;
};

export type ProjectedTarget = {
  id: string;
  /** What this column's own header calls it. */
  name: string;
  type: string;
  promptId?: string;
  promptVersionNumber?: number;
  /** True when the target runs an unsaved prompt draft. */
  hasDraft: boolean;
  model?: string;
  /** The saved evaluator an evaluator column runs. */
  targetEvaluatorId?: string;
  inputs: string[];
  outputs: string[];
  /** Set when this column judges other columns instead of producing output. */
  comparison?: ProjectedComparison;
  mappings?: Record<string, Record<string, unknown>>;
  /** Replaces `mappings` once the projection has to shrink. */
  mappingCount?: number;
};

export type ProjectedEvaluator = {
  id: string;
  /** What this evaluator is called on the board. */
  name: string;
  evaluatorType: string;
  dbEvaluatorId?: string;
  inputs: string[];
  /**
   * Set when this evaluator is a comparison column rather than a score
   * attached to every target column.
   */
  comparison?: ProjectedComparison;
  mappings?: Record<string, Record<string, Record<string, unknown>>>;
  mappingCount?: number;
};

export type ProjectedEvaluatorResults = {
  evaluatorId: string;
  name: string;
  passed: number;
  failed: number;
  errors: number;
  passRate: number | null;
  averageScore: number | null;
};

export type ProjectedTargetResults = {
  targetId: string;
  name: string;
  /** Rows this column has an output for. */
  filledCells: number;
  /** Rows the active dataset holds. */
  totalRows: number;
  completedRows: number;
  errorRows: number;
  /**
   * Distinct failure kinds seen in this column, at most
   * `ERROR_SAMPLE_LIMIT`. A code where the failure had one, an evaluator's
   * `error_type` otherwise. Dropped when the projection has to shrink.
   */
  errorTypes?: string[];
  /** Dropped when the projection has to shrink. */
  evaluators?: ProjectedEvaluatorResults[];
  overallPassRate: number | null;
  overallAverageScore: number | null;
  averageCost: number | null;
  totalCost: number | null;
  averageLatency: number | null;
};

export type ProjectedResults = {
  /** The run these cells came from, and the one to poll. */
  runId?: string;
  status: string;
  targets: ProjectedTargetResults[];
  /** Target summaries left out to fit the size budget. */
  omittedTargets?: number;
};

/** The name of each column, keyed by target id. */
export type TargetNames = Record<string, string>;

export type ProjectedWorkbenchState = {
  name: string;
  activeDatasetId: string;
  datasets: ProjectedDataset[];
  targets: ProjectedTarget[];
  evaluators: ProjectedEvaluator[];
  results?: ProjectedResults;
  /** Set when the projection dropped detail to fit the size budget. */
  truncated?: boolean;
  /** Entries left out of `datasets` to fit the size budget. */
  omittedDatasets?: number;
  /** Entries left out of `targets` to fit the size budget. */
  omittedTargets?: number;
  /** Entries left out of `evaluators` to fit the size budget. */
  omittedEvaluators?: number;
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

const utf8Encoder = new TextEncoder();

/**
 * The budget counts UTF-8 bytes, which is what a transport carries. A string's
 * `length` counts UTF-16 code units, so it under-reports every non-ASCII
 * character by a byte or two.
 */
const serializedSize = (projection: ProjectedWorkbenchState): number =>
  utf8Encoder.encode(JSON.stringify(projection)).length;

const isWithinBudget = (projection: ProjectedWorkbenchState): boolean =>
  serializedSize(projection) <= PROJECTION_BUDGET_BYTES;

const projectDataset = (dataset: DatasetReference): ProjectedDataset => ({
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
});

/**
 * What every column is called, disambiguated the way a run's errors do it.
 *
 * A resolved name comes from the caller: a prompt's handle lives in the
 * database, and this projection is pure. What state alone can answer is the
 * fallback, and the column's own id is the last one, which is at least the
 * thing every other field is keyed on.
 */
const nameTargets = ({
  targets,
  targetNames,
}: {
  targets: WorkbenchState["targets"];
  targetNames?: TargetNames;
}): Map<string, string> => {
  const raw = targets.map(
    (target) =>
      // An empty resolved name is "not known yet", which is the caller's
      // loading state and not a name to number as a duplicate.
      targetNames?.[target.id] ||
      target.localEvaluatorConfig?.name ||
      target.id,
  );
  const disambiguated = disambiguateNames(raw);
  return new Map(
    targets.map((target, index) => [
      target.id,
      disambiguated[index] ?? target.id,
    ]),
  );
};

/** What an evaluator is called: its own name, then the catalog's. */
const evaluatorName = (
  evaluator: WorkbenchState["evaluators"][number],
): string =>
  evaluator.localEvaluatorConfig?.name ??
  // A project's own evaluators carry a `custom/<id>` type the catalog has no
  // entry for, and fall through to the type itself.
  AVAILABLE_EVALUATORS[evaluator.evaluatorType as EvaluatorTypes]?.name ??
  evaluator.evaluatorType;

const projectComparison = ({
  comparison,
  names,
}: {
  comparison: ComparisonEvaluatorConfig;
  names: Map<string, string>;
}): ProjectedComparison => ({
  variants: comparison.variants,
  variantNames: comparison.variants.map(
    (variant) => names.get(variant) ?? variant,
  ),
  hasGoldenAnswer: comparison.hasGoldenAnswer,
  ...(comparison.goldenField ? { goldenField: comparison.goldenField } : {}),
});

const projectTarget = ({
  target,
  names,
}: {
  target: WorkbenchState["targets"][number];
  names: Map<string, string>;
}): ProjectedTarget => {
  const comparison = toComparisonConfig(target);
  return {
    id: target.id,
    name: names.get(target.id) ?? target.id,
    type: target.type,
    promptId: target.promptId,
    promptVersionNumber: target.promptVersionNumber,
    hasDraft: !!target.localPromptConfig,
    model: target.localPromptConfig?.llm.model,
    targetEvaluatorId: target.targetEvaluatorId,
    inputs: (target.inputs ?? []).map((input) => input.identifier),
    outputs: (target.outputs ?? []).map((output) => output.identifier),
    ...(comparison
      ? { comparison: projectComparison({ comparison, names }) }
      : {}),
    mappings: target.mappings,
  };
};

const projectEvaluator = ({
  evaluator,
  names,
}: {
  evaluator: WorkbenchState["evaluators"][number];
  names: Map<string, string>;
}): ProjectedEvaluator => {
  const comparison = toComparisonConfig(evaluator);
  return {
    id: evaluator.id,
    name: evaluatorName(evaluator),
    evaluatorType: evaluator.evaluatorType,
    dbEvaluatorId: evaluator.dbEvaluatorId,
    inputs: evaluator.inputs.map((input) => input.identifier),
    ...(comparison
      ? { comparison: projectComparison({ comparison, names }) }
      : {}),
    mappings: evaluator.mappings,
  };
};

/** Rows this column produced an output for. */
const countFilledCells = ({
  results,
  targetId,
  rowCount,
}: {
  results: EvaluationResults;
  targetId: string;
  rowCount: number;
}): number => {
  const outputs = results.targetOutputs[targetId] ?? [];
  let filled = 0;
  for (let index = 0; index < rowCount; index++) {
    const output = outputs[index];
    if (output !== undefined && output !== null) filled++;
  }
  return filled;
};

/**
 * The kinds of failure this column carries, not one entry per failed row.
 *
 * A column that failed the same way 200 times says so once. The target's own
 * failures report their code, and the evaluator rows report their `error_type`,
 * which is what names a comparison waiting on a column that never ran.
 */
const sampleErrorTypes = ({
  results,
  targetId,
  rowCount,
}: {
  results: EvaluationResults;
  targetId: string;
  rowCount: number;
}): string[] => {
  const errors = results.errors[targetId] ?? [];
  const metadata = results.targetMetadata[targetId] ?? [];
  const targetKinds = errors
    .slice(0, rowCount)
    .map((error, index) =>
      error
        ? (metadata[index]?.domainError?.code ??
          error.slice(0, ERROR_SAMPLE_MAX_CHARS))
        : undefined,
    );

  const evaluatorKinds = Object.values(
    results.evaluatorResults[targetId] ?? {},
  ).flatMap((rows) =>
    rows.slice(0, rowCount).map((row) => {
      const parsed = row as { status?: string; error_type?: string } | null;
      return parsed?.status === "error"
        ? (parsed.error_type ?? "EvaluatorError")
        : undefined;
    }),
  );

  const seen = new Set(
    [...targetKinds, ...evaluatorKinds].filter(
      (kind): kind is string => kind !== undefined,
    ),
  );
  return [...seen].slice(0, ERROR_SAMPLE_LIMIT);
};

const projectResults = ({
  state,
  results,
  activeRowCount,
  names,
}: {
  state: WorkbenchState;
  results: EvaluationResults;
  activeRowCount: number;
  names: Map<string, string>;
}): ProjectedResults => ({
  runId: results.runId,
  status: results.status,
  targets: state.targets.map((target) => {
    const aggregate = computeTargetAggregates(
      target.id,
      results,
      state.evaluators,
      activeRowCount,
    );
    const errorTypes = sampleErrorTypes({
      results,
      targetId: target.id,
      rowCount: activeRowCount,
    });
    return {
      targetId: target.id,
      name: names.get(target.id) ?? target.id,
      filledCells: countFilledCells({
        results,
        targetId: target.id,
        rowCount: activeRowCount,
      }),
      totalRows: activeRowCount,
      completedRows: aggregate.completedRows,
      errorRows: aggregate.errorRows,
      ...(errorTypes.length > 0 ? { errorTypes } : {}),
      evaluators: aggregate.evaluators.map((evaluator) => ({
        evaluatorId: evaluator.evaluatorId,
        name: evaluatorNameById(state, evaluator.evaluatorId),
        passed: evaluator.passed,
        failed: evaluator.failed,
        errors: evaluator.errors,
        passRate: evaluator.passRate,
        averageScore: evaluator.averageScore,
      })),
      overallPassRate: aggregate.overallPassRate,
      overallAverageScore: aggregate.overallAverageScore,
      averageCost: aggregate.averageCost,
      totalCost: aggregate.totalCost,
      averageLatency: aggregate.averageLatency,
    };
  }),
});

const evaluatorNameById = (
  state: WorkbenchState,
  evaluatorId: string,
): string => {
  const evaluator = state.evaluators.find((entry) => entry.id === evaluatorId);
  return evaluator ? evaluatorName(evaluator) : evaluatorId;
};

/**
 * One list the last resort may shorten, with the counter that records what it
 * left out.
 */
type TrimmableCollection = {
  items: unknown[];
  countOmitted: (omitted: number) => void;
};

/**
 * Last resort: drop whole entries, longest list first, until the projection
 * fits. Every stage before this one drops detail from an entry, and enough
 * entries overflow the budget on their own.
 */
const trimEntries = (projection: ProjectedWorkbenchState): void => {
  const collections: TrimmableCollection[] = [
    {
      items: projection.datasets,
      countOmitted: (omitted) => {
        projection.omittedDatasets =
          (projection.omittedDatasets ?? 0) + omitted;
      },
    },
    {
      items: projection.targets,
      countOmitted: (omitted) => {
        projection.omittedTargets = (projection.omittedTargets ?? 0) + omitted;
      },
    },
    {
      items: projection.evaluators,
      countOmitted: (omitted) => {
        projection.omittedEvaluators =
          (projection.omittedEvaluators ?? 0) + omitted;
      },
    },
  ];
  const results = projection.results;
  if (results) {
    collections.push({
      items: results.targets,
      countOmitted: (omitted) => {
        results.omittedTargets = (results.omittedTargets ?? 0) + omitted;
      },
    });
  }

  // Halving rather than popping one entry at a time: each step re-serializes
  // the projection, so a linear walk over thousands of targets is a lot of work
  // to reach the same place.
  while (!isWithinBudget(projection)) {
    const longest = collections.reduce((widest, candidate) =>
      candidate.items.length > widest.items.length ? candidate : widest,
    );
    if (longest.items.length === 0) break;
    const kept = Math.floor(longest.items.length / 2);
    longest.countOmitted(longest.items.length - kept);
    longest.items.length = kept;
  }
};

/**
 * The per-column totals stay — they are what says whether a run filled the
 * board — and the per-evaluator breakdown and the failure samples go, both of
 * which a scoped read can ask for again.
 */
const dropResultsDetail = (projection: ProjectedWorkbenchState): void => {
  for (const target of projection.results?.targets ?? []) {
    target.evaluators = undefined;
    target.errorTypes = undefined;
  }
};

/**
 * Drop detail until the projection fits the budget, in order of what an agent
 * can most easily ask for again. Mutates and returns the same object.
 */
const fitToBudget = (
  projection: ProjectedWorkbenchState,
): ProjectedWorkbenchState => {
  if (isWithinBudget(projection)) {
    return projection;
  }

  // Sample rows are the first to go: they are the only free-text payload here,
  // and an agent can always read a dataset row by row when it needs one.
  projection.truncated = true;
  for (const dataset of projection.datasets) {
    dataset.sampleRows = undefined;
  }
  if (isWithinBudget(projection)) {
    return projection;
  }

  // Then mappings collapse to counts. What survives is "this target is wired,
  // and how much of it", enough to decide whether to ask for the detail.
  for (const target of projection.targets) {
    target.mappingCount = countTargetMappings(target.mappings ?? {});
    target.mappings = undefined;
  }
  for (const evaluator of projection.evaluators) {
    evaluator.mappingCount = countEvaluatorMappings(evaluator.mappings ?? {});
    evaluator.mappings = undefined;
  }
  if (isWithinBudget(projection)) {
    return projection;
  }

  dropResultsDetail(projection);
  if (isWithinBudget(projection)) {
    return projection;
  }

  trimEntries(projection);
  if (isWithinBudget(projection)) {
    return projection;
  }

  // With every list empty, the name is the only free text left.
  projection.name = truncateCell(projection.name);

  return projection;
};

/**
 * Project the workbench for an agent.
 *
 * Pass `results` to include a per-target summary of the last run; without it
 * the projection is state only. Pass `targetNames` to give each column the
 * name its own header shows; without it the projection falls back to what the
 * state itself can answer. The output is capped at `PROJECTION_BUDGET_BYTES`
 * UTF-8 bytes: sample rows go first, then mappings collapse to counts, then the
 * results detail goes, then whole entries are dropped and counted in the
 * `omitted*` fields. `truncated` says so whenever anything was left out.
 */
export const projectWorkbenchState = ({
  state,
  results,
  targetNames,
}: {
  state: WorkbenchState;
  results?: EvaluationResults;
  targetNames?: TargetNames;
}): ProjectedWorkbenchState => {
  const activeDataset =
    state.datasets.find((d) => d.id === state.activeDatasetId) ??
    state.datasets[0];
  const activeRowCount = activeDataset ? datasetRowCount(activeDataset) : 0;
  const names = nameTargets({ targets: state.targets, targetNames });

  const projection: ProjectedWorkbenchState = {
    name: state.name,
    activeDatasetId: state.activeDatasetId,
    datasets: state.datasets.map(projectDataset),
    targets: state.targets.map((target) => projectTarget({ target, names })),
    evaluators: state.evaluators.map((evaluator) =>
      projectEvaluator({ evaluator, names }),
    ),
  };

  if (results) {
    projection.results = projectResults({
      state,
      results,
      activeRowCount,
      names,
    });
  }

  return fitToBudget(projection);
};
