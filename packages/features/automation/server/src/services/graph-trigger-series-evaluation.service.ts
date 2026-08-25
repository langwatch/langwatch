import {
  aggregateSeriesValues,
  extractSeriesPoints,
} from "@langwatch/analytics-contract";
import type { GraphTriggerEvaluationResult } from "@langwatch/automation-contract";
import {
  buildGraphSeriesName,
  GRAPH_TRIGGER_MAX_RESULT_ROWS,
  isTimeseriesResultTooLarge,
  skippedGraphEvaluation,
} from "./graph-trigger-evaluator.helpers";
import type {
  GraphEvaluationPlan,
  GraphSeriesEvaluation,
  TimeseriesResult,
} from "./graph-trigger-evaluator.types";

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
      plan.request.deps.telemetry.error(
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
      return skippedGraphEvaluation({
        ...plan.request,
        detail: "timeseries result exceeds the row ceiling",
      });
    }
  }

  private values(
    plan: GraphEvaluationPlan,
    result: TimeseriesResult,
  ): GraphSeriesEvaluation {
    const key = buildGraphSeriesName(plan.timeseriesInput.series[0]!, 0);
    const currentPoints = extractSeriesPoints(
      result.currentPeriod,
      key,
      plan.graph.groupBy,
    );
    const previousPoints = extractSeriesPoints(
      result.previousPeriod,
      key,
      plan.graph.groupBy,
    );
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
