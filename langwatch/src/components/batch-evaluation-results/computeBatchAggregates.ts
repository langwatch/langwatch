/**
 * Compute aggregate statistics from batch evaluation data.
 *
 * Similar to evaluations-v3/utils/computeAggregates.ts but works with
 * the transformed BatchEvaluationData format.
 */
import type { MetricStats } from "~/components/shared/MetricStatsTooltip";
import type {
  BatchEvaluationData,
  BatchResultRow,
  BatchTargetColumn,
} from "./types";

/**
 * Aggregate statistics for a target's evaluator results.
 */
export type BatchEvaluatorAggregate = {
  evaluatorId: string;
  evaluatorName: string;
  /** Total results processed */
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
 * Aggregate statistics for a target in batch results.
 */
export type BatchTargetAggregate = {
  targetId: string;
  /** Total rows with results */
  completedRows: number;
  /** Total rows */
  totalRows: number;
  /** Number of rows with errors */
  errorRows: number;
  /** Per-evaluator aggregates */
  evaluators: BatchEvaluatorAggregate[];
  /** Overall pass rate across all evaluators */
  overallPassRate: number | null;
  /** Overall average score across all evaluators with scores */
  overallAverageScore: number | null;
  /** Average cost in USD */
  averageCost: number | null;
  /** Total cost in USD */
  totalCost: number | null;
  /** Average latency in milliseconds */
  averageLatency: number | null;
  /** Total execution time in milliseconds */
  totalDuration: number | null;
  /** Detailed latency statistics */
  latencyStats: MetricStats | null;
  /** Detailed cost statistics */
  costStats: MetricStats | null;
};

/**
 * Computes percentile from a sorted array.
 */
const computePercentile = (
  sortedValues: number[],
  percentile: number,
): number => {
  if (sortedValues.length === 0) return 0;
  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower]!;
  return (
    sortedValues[lower]! +
    (sortedValues[upper]! - sortedValues[lower]!) * (index - lower)
  );
};

/**
 * Computes statistical breakdown for an array of values.
 */
const computeMetricStats = (values: number[]): MetricStats | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, v) => sum + v, 0);

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: total / values.length,
    median: computePercentile(sorted, 50),
    p75: computePercentile(sorted, 75),
    p90: computePercentile(sorted, 90),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    total,
    count: values.length,
  };
};

/**
 * Compute aggregate statistics for a single target from batch data.
 */
export const computeBatchTargetAggregates = (
  targetColumn: BatchTargetColumn,
  rows: BatchResultRow[],
): BatchTargetAggregate => {
  const targetId = targetColumn.id;

  let completedRows = 0;
  let errorRows = 0;
  const costValues: number[] = [];
  const latencyValues: number[] = [];

  // Collect evaluator results by evaluator ID
  const evaluatorResultsMap = new Map<
    string,
    {
      name: string;
      total: number;
      passed: number;
      failed: number;
      errors: number;
      scoreSum: number;
      scoreCount: number;
      // Count of results with explicit pass/fail (true/false, not null)
      passFailCount: number;
    }
  >();

  for (const row of rows) {
    const targetOutput = row.targets[targetId];
    if (!targetOutput) continue;

    // Count completed/error rows
    // A row is "completed" if it has output, error, OR evaluator results
    const hasOutput = targetOutput.output !== null;
    const hasError = !!targetOutput.error;
    const hasEvaluatorResults = targetOutput.evaluatorResults.length > 0;

    if (hasOutput || hasError || hasEvaluatorResults) {
      completedRows++;
    }
    if (hasError) {
      errorRows++;
    }

    // Collect cost and latency
    if (targetOutput.cost !== null) {
      costValues.push(targetOutput.cost);
    }
    if (targetOutput.duration !== null) {
      latencyValues.push(targetOutput.duration);
    }

    // Process evaluator results
    for (const evalResult of targetOutput.evaluatorResults) {
      let agg = evaluatorResultsMap.get(evalResult.evaluatorId);
      if (!agg) {
        agg = {
          name: evalResult.evaluatorName,
          total: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          scoreSum: 0,
          scoreCount: 0,
          passFailCount: 0,
        };
        evaluatorResultsMap.set(evalResult.evaluatorId, agg);
      }

      agg.total++;

      if (evalResult.status === "error") {
        agg.errors++;
      } else if (evalResult.passed === true) {
        agg.passed++;
        agg.passFailCount++;
      } else if (evalResult.passed === false) {
        agg.failed++;
        agg.passFailCount++;
      }
      // Note: passed === null means no pass/fail determination - don't count towards passFailCount

      if (evalResult.score !== null && evalResult.score !== undefined) {
        agg.scoreSum += evalResult.score;
        agg.scoreCount++;
      }
    }
  }

  // Compute detailed stats
  const latencyStats = computeMetricStats(latencyValues);
  const costStats = computeMetricStats(costValues);

  // Build evaluator aggregates
  const evaluatorAggregates: BatchEvaluatorAggregate[] = Array.from(
    evaluatorResultsMap.entries(),
  ).map(([evalId, agg]) => ({
    evaluatorId: evalId,
    evaluatorName: agg.name,
    total: agg.total,
    passed: agg.passed,
    failed: agg.failed,
    errors: agg.errors,
    // Pass rate only counts results with explicit pass/fail (true/false), not score-only results
    passRate:
      agg.passFailCount > 0 ? (agg.passed / agg.passFailCount) * 100 : null,
    averageScore: agg.scoreCount > 0 ? agg.scoreSum / agg.scoreCount : null,
  }));

  // Compute overall pass rate (only from evaluators with explicit pass/fail results)
  const totalPassFail = evaluatorAggregates.reduce(
    (sum, e) => sum + e.passed + e.failed,
    0,
  );
  const totalPassed = evaluatorAggregates.reduce((sum, e) => sum + e.passed, 0);
  const overallPassRate =
    totalPassFail > 0 ? (totalPassed / totalPassFail) * 100 : null;

  // Compute overall average score
  const scoresWithValues = evaluatorAggregates.filter(
    (e) => e.averageScore !== null,
  );
  const overallAverageScore =
    scoresWithValues.length > 0
      ? scoresWithValues.reduce((sum, e) => sum + (e.averageScore ?? 0), 0) /
        scoresWithValues.length
      : null;

  return {
    targetId,
    completedRows,
    totalRows: rows.length,
    errorRows,
    evaluators: evaluatorAggregates,
    overallPassRate,
    overallAverageScore,
    averageCost: costStats?.avg ?? null,
    totalCost: costStats?.total ?? null,
    averageLatency: latencyStats?.avg ?? null,
    totalDuration: latencyStats?.total ?? null,
    latencyStats,
    costStats,
  };
};

/**
 * Compute aggregates for all targets in batch data.
 */
export const computeAllBatchAggregates = (
  data: BatchEvaluationData,
): Map<string, BatchTargetAggregate> => {
  const aggregates = new Map<string, BatchTargetAggregate>();

  for (const targetCol of data.targetColumns) {
    aggregates.set(
      targetCol.id,
      computeBatchTargetAggregates(targetCol, data.rows),
    );
  }

  return aggregates;
};
