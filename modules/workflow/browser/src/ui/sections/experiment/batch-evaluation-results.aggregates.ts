import {
  computeMetricStats,
  type EvaluatorAggregate,
  type TargetAggregate,
} from "@langwatch/experiment-contract";

/**
 * Compute aggregate statistics from batch evaluation data.
 */
import type {
  BatchEvaluationData,
  BatchEvaluatorResult,
  BatchResultRow,
  BatchTargetColumn,
  BatchTargetOutput,
} from "./batch-evaluation-results.types.ts";

/** The contract's evaluator aggregate, named for the batch view. */
export type BatchEvaluatorAggregate = EvaluatorAggregate & { evaluatorName: string };

/** The contract's target aggregate, with batch evaluator aggregates. */
export type BatchTargetAggregate = Omit<TargetAggregate, "evaluators"> & {
  evaluators: BatchEvaluatorAggregate[];
};

/**
 * One evaluator's tally from its results against one target. The pass rate
 * counts only explicit pass/fail (`passed` true or false), not score-only results.
 */
const batchEvaluatorAggregate = (results: BatchEvaluatorResult[]): BatchEvaluatorAggregate => {
  const passed = results.filter((r) => r.status !== "error" && r.passed === true).length;
  const failed = results.filter((r) => r.status !== "error" && r.passed === false).length;
  const scores = results
    .map((r) => r.score)
    .filter((score): score is number => score !== null && score !== void 0);

  return {
    evaluatorId: results[0]?.evaluatorId ?? "",
    evaluatorName: results[0]?.evaluatorName ?? "",
    total: results.length,
    passed,
    failed,
    errors: results.filter((r) => r.status === "error").length,
    passRate: passed + failed > 0 ? (passed / (passed + failed)) * 100 : null,
    averageScore: scores.length > 0 ? scores.reduce((sum, v) => sum + v, 0) / scores.length : null,
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
  const outputs = rows
    .map((row) => row.targets[targetId])
    .filter((output): output is BatchTargetOutput => !!output);
  // A row is "completed" once it has output, an error, or any evaluator result.
  const completedRows = outputs.filter(
    (o) => o.output !== null || !!o.error || o.evaluatorResults.length > 0,
  ).length;
  const latencyStats = computeMetricStats(
    outputs.flatMap((o) => (o.duration !== null ? [o.duration] : [])),
  );
  const costStats = computeMetricStats(outputs.flatMap((o) => (o.cost !== null ? [o.cost] : [])));

  const resultsByEvaluator = new Map<string, BatchEvaluatorResult[]>();
  for (const result of outputs.flatMap((o) => o.evaluatorResults)) {
    resultsByEvaluator.set(result.evaluatorId, [
      ...(resultsByEvaluator.get(result.evaluatorId) ?? []),
      result,
    ]);
  }
  const evaluatorAggregates = [...resultsByEvaluator.values()].map(batchEvaluatorAggregate);

  // Overall pass rate only from evaluators with explicit pass/fail results.
  const totalPassFail = evaluatorAggregates.reduce((sum, e) => sum + e.passed + e.failed, 0);
  const totalPassed = evaluatorAggregates.reduce((sum, e) => sum + e.passed, 0);
  const averages = evaluatorAggregates.flatMap((e) =>
    e.averageScore !== null ? [e.averageScore] : [],
  );

  return {
    targetId,
    completedRows,
    totalRows: rows.length,
    errorRows: outputs.filter((o) => !!o.error).length,
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

/**
 * Compute aggregates for all targets in batch data.
 */
export const computeAllBatchAggregates = (
  data: BatchEvaluationData,
): Map<string, BatchTargetAggregate> => {
  const aggregates = new Map<string, BatchTargetAggregate>();

  for (const targetCol of data.targetColumns) {
    aggregates.set(targetCol.id, computeBatchTargetAggregates(targetCol, data.rows));
  }

  return aggregates;
};
