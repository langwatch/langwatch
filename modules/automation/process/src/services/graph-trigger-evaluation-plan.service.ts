import { parseSeriesIndex } from "@langwatch/automation-contract";
import type {
  EvaluationSkipCode,
  GraphTriggerEvaluationCondition,
  GraphTriggerEvaluationResult,
  Trigger,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";

import type {
  GraphActionParams,
  GraphEvaluationPlan,
  GraphEvaluationRequest,
  GraphSeries,
  StoredGraphConfig,
  TimeseriesInputType,
} from "../app/automation.members.ts";
import { skippedGraphEvaluation } from "../rules/trigger-evaluator.rules.ts";

export class GraphTriggerEvaluationPlanService {
  private constructor() {}

  static create(): GraphTriggerEvaluationPlanService {
    return new GraphTriggerEvaluationPlanService();
  }

  async createPlan(
    request: GraphEvaluationRequest,
  ): Promise<GraphEvaluationPlan | GraphTriggerEvaluationResult> {
    const trigger = await request.deps.triggers.findById(request);
    const ready = this.validateTrigger(request, trigger);
    if ("status" in ready) {
      return ready;
    }

    const graph = await request.deps.customGraphs.findById({
      customGraphId: ready.customGraphId,
      projectId: request.projectId,
    });
    if (!graph) {
      return this.skip({
        request,
        detail: "graph not found",
        skipCode: "subject_missing",
        condition: this.condition(ready.params),
      });
    }

    return this.createGraphPlan(request, ready, graph);
  }

  private validateTrigger(request: GraphEvaluationRequest, trigger: Trigger | null) {
    if (!trigger) {
      return this.skip({ request, detail: "trigger missing", skipCode: "subject_missing" });
    }

    if (!trigger.active) {
      return this.skip({ request, detail: "trigger inactive", skipCode: "inactive" });
    }

    if (!trigger.customGraphId) {
      return this.skip({
        request,
        detail: "trigger has no customGraphId",
        skipCode: "subject_missing",
      });
    }

    const params = (trigger.actionParams ?? {}) as GraphActionParams;
    if (params.threshold === void 0 || params.operator === void 0 || params.timePeriod === void 0) {
      return this.skip({
        request,
        detail: "missing threshold / operator / timePeriod",
        skipCode: "incomplete_configuration",
      });
    }

    if (!params.seriesName) {
      return this.skip({
        request,
        detail: "missing seriesName",
        skipCode: "incomplete_configuration",
      });
    }

    return { trigger, customGraphId: trigger.customGraphId, params };
  }

  private createGraphPlan(
    request: GraphEvaluationRequest,
    trigger: {
      trigger: GraphEvaluationPlan["trigger"];
      customGraphId: string;
      params: GraphActionParams;
    },
    customGraph: GraphEvaluationPlan["customGraph"],
  ): GraphEvaluationPlan | GraphTriggerEvaluationResult {
    const graph = customGraph.graph as StoredGraphConfig | null;
    const condition = this.condition(trigger.params);
    if (!graph?.series?.length) {
      return this.skip({
        request,
        detail: "graph has no series",
        skipCode: "incomplete_configuration",
        condition,
      });
    }

    const series = this.series({
      request,
      graph,
      seriesName: trigger.params.seriesName!,
      condition,
    });
    if ("status" in series) {
      return series;
    }

    const now = request.deps.clock.now();
    const startDate = now.subtract({ milliseconds: trigger.params.timePeriod! * 60 * 1000 });

    return {
      request,
      ...trigger,
      customGraph,
      threshold: trigger.params.threshold!,
      operator: trigger.params.operator!,
      timePeriod: trigger.params.timePeriod!,
      seriesName: trigger.params.seriesName!,
      series,
      graph,
      now,
      startDate,
      timeseriesInput: this.timeseriesInput({
        projectId: request.projectId,
        filters: customGraph.filters,
        graph,
        series,
        startDate,
        endDate: now,
      }),
    };
  }

  private series({
    request,
    graph,
    seriesName,
    condition,
  }: {
    request: GraphEvaluationRequest;
    graph: StoredGraphConfig;
    seriesName: string;
    condition: GraphTriggerEvaluationCondition;
  }) {
    const index = parseSeriesIndex(seriesName);
    if (Number.isNaN(index) || index < 0 || index >= graph.series.length) {
      return this.skip({
        request,
        detail: `series index ${index} not in graph`,
        skipCode: "incomplete_configuration",
        condition,
      });
    }

    const series = graph.series[index];
    if (!series?.name || !series.metric || !series.aggregation) {
      return this.skip({
        request,
        detail: "invalid series configuration",
        skipCode: "incomplete_configuration",
        condition,
      });
    }

    return series;
  }

  private timeseriesInput({
    projectId,
    filters,
    graph,
    series,
    startDate,
    endDate,
  }: {
    projectId: string;
    filters: unknown;
    graph: StoredGraphConfig;
    series: GraphSeries;
    startDate: Instant;
    endDate: Instant;
  }): TimeseriesInputType {
    return {
      projectId,
      startDate: startDate.epochMilliseconds,
      endDate: endDate.epochMilliseconds,
      filters: (filters ?? {}) as TimeseriesInputType["filters"],
      series: [{ ...series, name: void 0 }],
      groupBy: graph.groupBy,
      timeScale: graph.timeScale ?? 60,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  /** The condition, known once the trigger validated: every later skip records it. */
  private condition(params: GraphActionParams): GraphTriggerEvaluationCondition {
    return {
      threshold: params.threshold!,
      operator: params.operator!,
      timePeriodMinutes: params.timePeriod!,
    };
  }

  private skip({
    request,
    detail,
    skipCode,
    condition,
  }: {
    request: GraphEvaluationRequest;
    detail: string;
    skipCode: EvaluationSkipCode;
    condition?: GraphTriggerEvaluationCondition;
  }): GraphTriggerEvaluationResult {
    return skippedGraphEvaluation({ ...request, detail, skipCode, condition });
  }
}
