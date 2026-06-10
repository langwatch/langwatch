import { parseEvaluationResult } from "~/utils/evaluationResults";
import {
  computeMetricStats,
  type MetricStats,
} from "~/components/shared/MetricStatsTooltip";
import type { EvaluationResults } from "../types";

export { computeMetricStats, type MetricStats };

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

/**
 * Computes aggregate statistics for a target from evaluation results.
 */
export const computeTargetAggregates = (
  targetId: string,
  results: EvaluationResults,
  evaluators: Array<{ id: string }>,
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
      // Count results that have explicit pass/fail for pass rate calculation
      let passFailCount = 0;

      for (let i = 0; i < rowCount; i++) {
        const result = evalResults[i];
        if (result === undefined || result === null) continue;

        const parsed = parseEvaluationResult(result);
        if (parsed.status === "pending" || parsed.status === "running")
          continue;

        total++;

        if (parsed.status === "passed") {
          passed++;
          passFailCount++;
        } else if (parsed.status === "failed") {
          failed++;
          passFailCount++;
        } else if (parsed.status === "error") {
          errors++;
        }
        // "processed" and "skipped" don't count towards pass rate

        if (parsed.score !== undefined && parsed.score !== null) {
          scoreSum += parsed.score;
          scoreCount++;
        }
      }

      return {
        evaluatorId: evaluator.id,
        total,
        passed,
        failed,
        errors,
        // Pass rate only counts results with explicit pass/fail, not score-only ("processed")
        passRate: passFailCount > 0 ? (passed / passFailCount) * 100 : null,
        averageScore: scoreCount > 0 ? scoreSum / scoreCount : null,
      };
    },
  );

  // Compute overall pass rate (sum of passed / sum of passed+failed)
  // Only count evaluators that have explicit pass/fail results, not score-only
  const totalPassFail = evaluatorAggregates.reduce(
    (sum, e) => sum + e.passed + e.failed,
    0,
  );
  const totalPassed = evaluatorAggregates.reduce((sum, e) => sum + e.passed, 0);
  const overallPassRate =
    totalPassFail > 0 ? (totalPassed / totalPassFail) * 100 : null;

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
