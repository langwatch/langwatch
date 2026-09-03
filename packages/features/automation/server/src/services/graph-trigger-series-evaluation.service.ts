import { aggregateSeriesValues, extractSeriesPoints } from "@langwatch/analytics-contract";
import type { GraphTriggerEvaluationResult } from "@langwatch/automation-contract";
import {
  GRAPH_TRIGGER_MAX_RESULT_ROWS,
  TriggerEvaluatorService,
} from "./trigger-evaluator.service";
import type {
  GraphEvaluationPlan,
  GraphSeries,
  GraphSeriesEvaluation,
  TimeseriesResult,
} from "./trigger-evaluator.service";

/** ClickHouse's "too many rows or bytes", however the client spelled it. */
function isTimeseriesResultTooLarge(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 396 || code === "396") {
    return true;
  }

  return (error instanceof Error ? error.message : String(error)).includes(
    "TOO_MANY_ROWS_OR_BYTES",
  );
}

/** The key analytics returns a series under, which the reader must rebuild to
 *  find it in the result. */
function graphSeriesName(series: GraphSeries, index: number): string {
  const aggregation = series.aggregation === "terms" ? "cardinality" : series.aggregation;
  if (series.pipeline) {
    return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
  }
  if (series.key) {
    return `${index}/${series.metric}/${aggregation}/${series.key}`;
  }
  return `${index}/${series.metric}/${aggregation}`;
}

export class GraphTriggerSeriesEvaluationService {
  private constructor() {}

  static create(): GraphTriggerSeriesEvaluationService {
    return new GraphTriggerSeriesEvaluationService();
  }

  async evaluate(
    plan: GraphEvaluationPlan,
  ): Promise<GraphSeriesEvaluation | GraphTriggerEvaluationResult> {
    const result = await this.read(plan);
    if ("status" in result) {
      return result;
    }

    return this.values(plan, result);
  }

  private async read(
    plan: GraphEvaluationPlan,
  ): Promise<TimeseriesResult | GraphTriggerEvaluationResult> {
    try {
      return (await plan.request.deps.analytics.getTimeseries(plan.timeseriesInput, {
        maxResultRows: GRAPH_TRIGGER_MAX_RESULT_ROWS,
      })) as TimeseriesResult;
    } catch (error) {
      if (!isTimeseriesResultTooLarge(error)) {
        throw error;
      }

      plan.request.deps.logger.error(
        {
          projectId: plan.request.projectId,
          triggerId: plan.request.triggerId,
          reason: plan.request.reason,
          groupBy: plan.graph.groupBy,
          timePeriodMinutes: plan.timePeriod,
          maxResultRows: GRAPH_TRIGGER_MAX_RESULT_ROWS,
        },
        "graph trigger evaluation skipped: timeseries result exceeds the row ceiling",
      );

      return TriggerEvaluatorService.skippedGraphEvaluation({
        ...plan.request,
        detail: "timeseries result exceeds the row ceiling",
      });
    }
  }

  private values(plan: GraphEvaluationPlan, result: TimeseriesResult): GraphSeriesEvaluation {
    const key = graphSeriesName(plan.timeseriesInput.series[0]!, 0);
    const currentPoints = extractSeriesPoints(result.currentPeriod, key, plan.graph.groupBy);
    const previousPoints = extractSeriesPoints(result.previousPeriod, key, plan.graph.groupBy);

    return {
      currentPoints,
      previousPoints,
      currentValue: this.aggregate(currentPoints, plan, result.currentPeriod.length),
      previousValue:
        result.previousPeriod.length === 0
          ? null
          : this.aggregate(previousPoints, plan, result.previousPeriod.length),
    };
  }

  private aggregate(
    points: Array<{ value: number }>,
    plan: GraphEvaluationPlan,
    bucketCount: number,
  ): number {
    return aggregateSeriesValues(
      points.map((point) => point.value),
      plan.series.aggregation,
      bucketCount,
    );
  }
}
