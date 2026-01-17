import { parseEvaluationResult } from "~/utils/evaluationResults";
import type { EvaluationResults } from "../types";

/**
 * Statistical breakdown for a numeric metric (latency or cost).
 */
export type MetricStats = {
  min: number;
  max: number;
  avg: number;
  median: number; // p50
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  total: number;
  count: number;
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
export const computeMetricStats = (values: number[]): MetricStats | null => {
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
 * Aggregate statistics for a target's evaluator results.
 */
export type EvaluatorAggregate = {
  evaluatorId: string;
  evaluatorName: string;
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

/**
 * Computes aggregate statistics for a target from evaluation results.
 */
export const computeTargetAggregates = (
  targetId: string,
  results: EvaluationResults,
  evaluators: Array<{ id: string; name: string }>,
  rowCount: number,
): TargetAggregate => {
  const targetOutputs = results.targetOutputs[targetId] ?? [];
  const targetMetadata = results.targetMetadata?.[targetId] ?? [];
  const targetErrors = results.errors[targetId] ?? [];
  const evaluatorResults = results.evaluatorResults[targetId] ?? {};

  // Count completed rows and compute cost/latency averages
  // A row is "complete" only when target output is done AND all evaluators have finished
  let completedRows = 0;
  let errorRows = 0;
  const costValues: number[] = [];
  const latencyValues: number[] = [];

  for (let i = 0; i < rowCount; i++) {
    const hasOutput =
      targetOutputs[i] !== undefined && targetOutputs[i] !== null;
    const hasError = !!targetErrors[i];

    // Check if all evaluators have completed for this row
    const allEvaluatorsComplete =
      evaluators.length === 0 ||
      evaluators.every((evaluator) => {
        const evalResult = evaluatorResults[evaluator.id]?.[i];
        if (evalResult === undefined || evalResult === null) return false;
        const parsed = parseEvaluationResult(evalResult);
        // Complete means not pending and not running
        return parsed.status !== "pending" && parsed.status !== "running";
      });

    // Row is complete only when target is done AND all evaluators are done
    if ((hasOutput || hasError) && allEvaluatorsComplete) {
      completedRows++;
    }
    if (hasError) {
      errorRows++;
    }

    // Collect cost and latency values from metadata
    const metadata = targetMetadata[i];
    if (metadata) {
      if (metadata.cost !== undefined && metadata.cost !== null) {
        costValues.push(metadata.cost);
      }
      if (metadata.duration !== undefined && metadata.duration !== null) {
        latencyValues.push(metadata.duration);
      }
    }
  }

  // Compute detailed stats
  const latencyStats = computeMetricStats(latencyValues);
  const costStats = computeMetricStats(costValues);

  // Compute per-evaluator aggregates
  const evaluatorAggregates: EvaluatorAggregate[] = evaluators.map(
    (evaluator) => {
      const evalResults = evaluatorResults[evaluator.id] ?? [];

      let total = 0;
      let passed = 0;
      let failed = 0;
      let errors = 0;
      let scoreSum = 0;
      let scoreCount = 0;

      for (let i = 0; i < rowCount; i++) {
        const result = evalResults[i];
        if (result === undefined || result === null) continue;

        const parsed = parseEvaluationResult(result);
        if (parsed.status === "pending" || parsed.status === "running")
          continue;

        total++;

        if (parsed.status === "passed") {
          passed++;
        } else if (parsed.status === "failed") {
          failed++;
        } else if (parsed.status === "error") {
          errors++;
        }

        if (parsed.score !== undefined && parsed.score !== null) {
          scoreSum += parsed.score;
          scoreCount++;
        }
      }

      return {
        evaluatorId: evaluator.id,
        evaluatorName: evaluator.name,
        total,
        passed,
        failed,
        errors,
        passRate: total > 0 ? (passed / total) * 100 : null,
        averageScore: scoreCount > 0 ? scoreSum / scoreCount : null,
      };
    },
  );

  // Compute overall pass rate (sum of all passed / sum of all total)
  const totalEvaluations = evaluatorAggregates.reduce(
    (sum, e) => sum + e.total,
    0,
  );
  const totalPassed = evaluatorAggregates.reduce((sum, e) => sum + e.passed, 0);
  const overallPassRate =
    totalEvaluations > 0 ? (totalPassed / totalEvaluations) * 100 : null;

  // Compute overall average score (across all evaluators with scores)
  const _allScoreSums = evaluatorAggregates.reduce(
    (acc, e) => {
      if (e.averageScore !== null) {
        return {
          sum: acc.sum + e.averageScore * e.total,
          count: acc.count + e.total,
        };
      }
      return acc;
    },
    { sum: 0, count: 0 },
  );
  // Actually we want the average of the individual scores, not weighted by total
  // Let's just average the non-null averageScores
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
    totalRows: rowCount,
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
 * Formats a pass rate for display.
 */
export const formatPassRate = (passRate: number | null): string => {
  if (passRate === null) return "-";
  return `${Math.round(passRate)}%`;
};

// Re-export shared formatters for backward compatibility
export {
  formatCost,
  formatLatency,
  formatScore,
} from "~/components/shared/formatters";
