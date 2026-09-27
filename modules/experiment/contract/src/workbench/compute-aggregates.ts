import { parseEvaluationResult } from "@langwatch/evaluator-contract";

import type { EvaluationResults, EvaluatorConfig, TargetConfig } from "../experiment-workbench.ts";
import { computeMetricStats, type MetricStats } from "./metric-stats.ts";
import { resolveVerdictLabel, toComparisonConfig } from "./normalize-comparison.ts";

/**
 * Aggregate statistics for a target's evaluator results.
 */
export type EvaluatorAggregate = {
  evaluatorId: string;
  /** Total results processed (not pending) */
  total: number;
  /** Number of passed evaluations */
  passed: number;
  /** Number of failed evaluations */
  failed: number;
  /** Number of errors */
  errors: number;
  /** Pass rate as percentage (0-100) */
  passRate: number | null;
  /** Average score (if scores are available) */
  averageScore: number | null;
};

/**
 * Aggregate statistics for a target.
 */
export type TargetAggregate = {
  targetId: string;
  /** Total rows with results (not pending/loading) */
  completedRows: number;
  /** Total rows */
  totalRows: number;
  /** Number of rows with errors */
  errorRows: number;
  /** Per-evaluator aggregates */
  evaluators: EvaluatorAggregate[];
  /** Overall pass rate across all evaluators */
  overallPassRate: number | null;
  /** Overall average score across all evaluators with scores */
  overallAverageScore: number | null;
  /** Average cost in USD (across completed rows) */
  averageCost: number | null;
  /** Total cost in USD */
  totalCost: number | null;
  /** Average latency in milliseconds */
  averageLatency: number | null;
  /** Total execution time in milliseconds (sum of all row durations) */
  totalDuration: number | null;
  /** Detailed latency statistics */
  latencyStats: MetricStats | null;
  /** Detailed cost statistics */
  costStats: MetricStats | null;
};

const isSettled = (result: unknown): boolean => {
  if (result === undefined || result === null) return false;
  const { status } = parseEvaluationResult(result);
  return status !== "pending" && status !== "running";
};

type TargetRowProgress = {
  completedRows: number;
  errorRows: number;
  costValues: number[];
  latencyValues: number[];
};

/**
 * A row is complete once its output (or error) is in AND every evaluator has
 * settled; its metadata carries the cost and latency the header averages.
 */
const targetRowProgress = ({
  targetId,
  results,
  evaluators,
  rowCount,
}: {
  targetId: string;
  results: EvaluationResults;
  evaluators: { id: string }[];
  rowCount: number;
}): TargetRowProgress => {
  const targetOutputs = results.targetOutputs[targetId] ?? [];
  const targetMetadata = results.targetMetadata?.[targetId] ?? [];
  const targetErrors = results.errors[targetId] ?? [];
  const evaluatorResults = results.evaluatorResults[targetId] ?? {};
  const progress: TargetRowProgress = {
    completedRows: 0,
    errorRows: 0,
    costValues: [],
    latencyValues: [],
  };

  for (let i = 0; i < rowCount; i++) {
    const hasOutput = targetOutputs[i] !== undefined && targetOutputs[i] !== null;
    const hasError = !!targetErrors[i];
    const allSettled = evaluators.every((evaluator) =>
      isSettled(evaluatorResults[evaluator.id]?.[i]),
    );
    if ((hasOutput || hasError) && allSettled) progress.completedRows++;
    if (hasError) progress.errorRows++;

    const metadata = targetMetadata[i];
    if (metadata?.cost !== undefined && metadata.cost !== null) {
      progress.costValues.push(metadata.cost);
    }
    if (metadata?.duration !== undefined && metadata.duration !== null) {
      progress.latencyValues.push(metadata.duration);
    }
  }

  return progress;
};

/**
 * One evaluator's tally over the settled rows. The pass rate counts only
 * explicit pass/fail verdicts; "processed" and "skipped" never count toward it.
 */
const evaluatorAggregateFor = ({
  evaluatorId,
  evalResults,
  rowCount,
}: {
  evaluatorId: string;
  evalResults: unknown[];
  rowCount: number;
}): EvaluatorAggregate => {
  const parsed = evalResults
    .slice(0, rowCount)
    .filter(isSettled)
    .map((result) => parseEvaluationResult(result));
  const passed = parsed.filter((r) => r.status === "passed").length;
  const failed = parsed.filter((r) => r.status === "failed").length;
  const scores = parsed
    .map((r) => r.score)
    .filter((score): score is number => score !== undefined && score !== null);

  return {
    evaluatorId,
    total: parsed.length,
    passed,
    failed,
    errors: parsed.filter((r) => r.status === "error").length,
    passRate: passed + failed > 0 ? (passed / (passed + failed)) * 100 : null,
    averageScore: scores.length > 0 ? scores.reduce((sum, v) => sum + v, 0) / scores.length : null,
  };
};

/**
 * Computes aggregate statistics for a target from evaluation results.
 */
export const computeTargetAggregates = ({
  targetId,
  results,
  evaluators,
  rowCount,
}: {
  targetId: string;
  results: EvaluationResults;
  evaluators: { id: string }[];
  rowCount: number;
}): TargetAggregate => {
  const progress = targetRowProgress({ targetId, results, evaluators, rowCount });
  const latencyStats = computeMetricStats(progress.latencyValues);
  const costStats = computeMetricStats(progress.costValues);
  const evaluatorResults = results.evaluatorResults[targetId] ?? {};
  const evaluatorAggregates = evaluators.map((evaluator) =>
    evaluatorAggregateFor({
      evaluatorId: evaluator.id,
      evalResults: evaluatorResults[evaluator.id] ?? [],
      rowCount,
    }),
  );

  // Overall pass rate: passed over passed+failed, across evaluators with explicit verdicts.
  const totalPassFail = evaluatorAggregates.reduce((sum, e) => sum + e.passed + e.failed, 0);
  const totalPassed = evaluatorAggregates.reduce((sum, e) => sum + e.passed, 0);
  // Overall score: the plain mean of each evaluator's own average, not weighted by rows.
  const averages = evaluatorAggregates
    .map((e) => e.averageScore)
    .filter((score): score is number => score !== null);

  return {
    targetId,
    completedRows: progress.completedRows,
    totalRows: rowCount,
    errorRows: progress.errorRows,
    evaluators: evaluatorAggregates,
    overallPassRate: totalPassFail > 0 ? (totalPassed / totalPassFail) * 100 : null,
    overallAverageScore:
      averages.length > 0 ? averages.reduce((sum, v) => sum + v, 0) / averages.length : null,
    averageCost: costStats?.avg ?? null,
    totalCost: costStats?.total ?? null,
    averageLatency: latencyStats?.avg ?? null,
    totalDuration: latencyStats?.total ?? null,
    latencyStats,
    costStats,
  };
};

/** The finite numbers among `values`. */
const finiteNumbers = (values: unknown[]): number[] =>
  values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const sumOf = (values: number[]): number => values.reduce((sum, v) => sum + v, 0);

/**
 * Compute aggregate stats for a comparison column so the workbench header
 * renders the same Rows/Latency/Cost/Time chip as prompt/agent columns.
 */
export const computeComparisonColumnTargetAggregate = (
  target: {
    id: string;
    comparison?: { variants?: string[] } | null;
  },
  results: EvaluationResults,
  rowCount: number,
): TargetAggregate => {
  const variantIds = target.comparison?.variants ?? [];
  const metadataByVariant = variantIds.map((id) => results.targetMetadata[id] ?? []);
  const verdicts = results.evaluatorResults[target.id]?.[target.id] ?? [];

  let completedRows = 0;
  const costValues: number[] = [];
  const latencyValues: number[] = [];

  for (let i = 0; i < rowCount; i++) {
    const rowMetadata = metadataByVariant.map((m) => m[i]);
    const verdict = verdicts[i];
    if (!rowMetadata.some(Boolean) && !verdict) continue;
    completedRows++;

    const judgeCost = verdict ? readCostAmount(verdict) : 0;
    const rowCosts = finiteNumbers([
      ...rowMetadata.map((m) => m?.cost),
      judgeCost > 0 ? judgeCost : undefined,
    ]);
    if (rowCosts.length > 0) costValues.push(sumOf(rowCosts));
    const rowLatencies = finiteNumbers(rowMetadata.map((m) => m?.duration));
    if (rowLatencies.length > 0) latencyValues.push(sumOf(rowLatencies));
  }

  const costStats = computeMetricStats(costValues);
  const latencyStats = computeMetricStats(latencyValues);

  return {
    targetId: target.id,
    completedRows,
    totalRows: rowCount,
    errorRows: 0,
    evaluators: [],
    overallPassRate: null,
    overallAverageScore: null,
    averageCost: costStats?.avg ?? null,
    totalCost: costStats?.total ?? null,
    averageLatency: latencyStats?.avg ?? null,
    totalDuration: latencyStats?.total ?? null,
    latencyStats,
    costStats,
  };
};

const readCostAmount = (raw: unknown): number => {
  if (!raw || typeof raw !== "object") return 0;
  const cost = (raw as { cost?: unknown }).cost;
  if (!cost || typeof cost !== "object") return 0;
  const amount = (cost as { amount?: unknown }).amount;
  return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
};

/**
 * A comparison's win tally across all rows, for any number of variants.
 */
export type ComparisonAggregate = {
  evaluatorId: string;
  variants: string[];
  /** Wins keyed by the winning candidate's identifier. Excludes ties. */
  winsByLabel: Record<string, number>;
  ties: number;
  /** Rows that produced a usable verdict — wins plus ties. */
  decidedRows: number;
  /** The highest win count any single identifier holds; 0 when none won. */
  topCount: number;
  /** The sole identifier holding `topCount`; unset when two or more share it. */
  topLabel?: string;
  totalCost: number;
};

export const computeComparisonAggregate = (
  evaluator: Pick<EvaluatorConfig, "id" | "pairwise" | "comparison">,
  results: EvaluationResults,
  rowCount: number,
): ComparisonAggregate | null => {
  const comparison = toComparisonConfig(evaluator);
  if (!comparison) return null;
  return computeComparisonAggregateFromResults({
    id: evaluator.id,
    variants: comparison.variants,
    results,
    rowCount,
    // Chip-style comparison verdicts hang under the first variant's column.
    resultTargetId: comparison.variants[0] ?? evaluator.id,
  });
};

export const computeComparisonTargetAggregate = (
  target: Pick<TargetConfig, "id" | "pairwise" | "comparison">,
  results: EvaluationResults,
  rowCount: number,
): ComparisonAggregate | null => {
  const comparison = toComparisonConfig(target);
  if (!comparison) return null;
  return computeComparisonAggregateFromResults({
    id: target.id,
    variants: comparison.variants,
    results,
    rowCount,
    // Column-style comparison verdicts hang under the column-target itself.
    resultTargetId: target.id,
  });
};

const computeComparisonAggregateFromResults = ({
  id,
  variants,
  results,
  rowCount,
  resultTargetId,
}: {
  id: string;
  variants: string[];
  results: EvaluationResults;
  rowCount: number;
  resultTargetId: string;
}): ComparisonAggregate => {
  const evalResults = results.evaluatorResults[resultTargetId]?.[id] ?? [];

  const winsByLabel: Record<string, number> = {};
  let ties = 0;
  let totalCost = 0;

  for (let i = 0; i < rowCount; i++) {
    const raw = evalResults[i];
    const parsed = parseEvaluationResult(raw);
    if (parsed.status !== "processed" || !parsed.label) continue;

    // Runs stored before the merge label the winner by slot ("A" / "B")
    // rather than by identifier. Map those onto the variant they name.
    const label = resolveVerdictLabel({ label: parsed.label, variants });

    totalCost += readCostAmount(raw);
    if (label === "tie") ties++;
    else winsByLabel[label] = (winsByLabel[label] ?? 0) + 1;
  }

  const entries = Object.entries(winsByLabel);
  const topCount = entries.reduce((max, [, count]) => Math.max(max, count), 0);
  const leaders = entries.filter(([, count]) => count === topCount);

  return {
    evaluatorId: id,
    variants,
    winsByLabel,
    ties,
    decidedRows: entries.reduce((sum, [, count]) => sum + count, 0) + ties,
    topCount,
    topLabel: leaders.length === 1 ? leaders[0]![0] : undefined,
    totalCost,
  };
};

/**
 * Formats a pass rate for display.
 */
export const formatPassRate = (passRate: number | null): string => {
  if (passRate === null) return "-";
  return `${Math.round(passRate)}%`;
};
