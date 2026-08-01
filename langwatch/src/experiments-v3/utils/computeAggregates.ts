import {
  computeMetricStats,
  type MetricStats,
} from "~/components/shared/MetricStatsTooltip";
import { parseEvaluationResult } from "~/utils/evaluationResults";
import type {
  EvaluationResults,
  EvaluatorConfig,
  TargetConfig,
} from "../types";
import { resolveVerdictLabel, toComparisonConfig } from "./normalizeComparison";

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
 * Compute a TargetAggregate-shaped object for a comparison column-target so
 * the workbench header can render the same Rows / Avg Latency / Total Cost /
 * Execution Time chip prompt/agent columns render (dogfood: "I already have
 * the scores on the results page — I want the same in the workbench").
 *
 * Comparison column-target cells hit the orchestrator's `skipTarget: true`
 * branch — no target execution → target_result fires with undefined
 * cost/duration → workbench `targetMetadata[comparisonId]` carries no
 * metrics. We reconstruct them the way the results page does:
 *   - cost per row = every variant's cost + judge (evaluator) cost
 *   - duration per row = every variant's duration (judge duration isn't
 *     persisted on evaluator results)
 *
 * A row counts as "complete" when any variant produced metadata for it —
 * matching how the popover renders on the results page.
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
  const metadataByVariant = variantIds.map(
    (id) => results.targetMetadata[id] ?? [],
  );
  const verdicts = results.evaluatorResults[target.id]?.[target.id] ?? [];

  let completedRows = 0;
  const costValues: number[] = [];
  const latencyValues: number[] = [];

  for (let i = 0; i < rowCount; i++) {
    const rowMetadata = metadataByVariant.map((m) => m[i]);
    const verdict = verdicts[i];
    if (!rowMetadata.some(Boolean) && !verdict) continue;
    completedRows++;

    let rowCost = 0;
    let sawCost = false;
    for (const m of rowMetadata) {
      if (m && typeof m.cost === "number" && Number.isFinite(m.cost)) {
        rowCost += m.cost;
        sawCost = true;
      }
    }
    if (verdict) {
      const judgeCost = readCostAmount(verdict);
      if (judgeCost > 0) {
        rowCost += judgeCost;
        sawCost = true;
      }
    }
    if (sawCost) costValues.push(rowCost);

    let rowLatency = 0;
    let sawLatency = false;
    for (const m of rowMetadata) {
      if (m && typeof m.duration === "number" && Number.isFinite(m.duration)) {
        rowLatency += m.duration;
        sawLatency = true;
      }
    }
    if (sawLatency) latencyValues.push(rowLatency);
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
 *
 * Wins are keyed by the raw identifier the judge returned rather than by
 * variant id, because resolving an identifier back to a variant needs that
 * variant's prompt handle — and handles only come from `useTargetName`, a
 * hook, which cannot be called once per variant from a loop. Each variant
 * therefore looks up its own count (see `ComparisonScoreboard`), and the
 * winner is derived from the counts alone: every non-tie identifier the
 * judge emits belongs to some variant, so whichever holds `topCount` won.
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

// Re-export shared formatters for backward compatibility
export {
  formatCost,
  formatLatency,
  formatScore,
} from "~/components/shared/formatters";
