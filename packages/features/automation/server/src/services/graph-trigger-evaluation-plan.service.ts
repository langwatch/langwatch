import { parseSeriesIndex } from "@langwatch/automation-contract";
import type {
  GraphTriggerEvaluationResult,
  Trigger,
} from "@langwatch/automation-contract";
import { skippedGraphEvaluation } from "./graph-trigger-evaluator.helpers";
import type {
  GraphActionParams,
  GraphEvaluationPlan,
  GraphEvaluationRequest,
  GraphSeries,
  StoredGraphConfig,
  TimeseriesInputType,
} from "./graph-trigger-evaluator.types";

export class GraphTriggerEvaluationPlanService {
  private constructor() {}

  static create(): GraphTriggerEvaluationPlanService {
    return new GraphTriggerEvaluationPlanService();
  }

  async createPlan(
    request: GraphEvaluationRequest,
  ): Promise<GraphEvaluationPlan | GraphTriggerEvaluationResult> {
    const trigger = await request.deps.triggers.tryFindById(request);
    const ready = this.validateTrigger(request, trigger);
    if ("status" in ready) {
      return ready;
    }
    const graph = await request.deps.customGraphs.tryFindById({
      customGraphId: ready.customGraphId,
      projectId: request.projectId,
    });
    if (!graph) {
      return this.skip(request, "graph not found");
    }
    return this.createGraphPlan(request, ready, graph);
  }

  private validateTrigger(request: GraphEvaluationRequest, trigger: Trigger | null) {
    if (!trigger) {
      return this.skip(request, "trigger missing");
    }
    if (!trigger.active) {
      return this.skip(request, "trigger inactive");
    }
    if (!trigger.customGraphId) {
      return this.skip(request, "trigger has no customGraphId");
    }
    const params = (trigger.actionParams ?? {}) as GraphActionParams;
    if (
      params.threshold === void 0 ||
      params.operator === void 0 ||
      params.timePeriod === void 0
    ) {
      return this.skip(request, "missing threshold / operator / timePeriod");
    }
    if (!params.seriesName) {
      return this.skip(request, "missing seriesName");
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
    if (!graph?.series?.length) {
      return this.skip(request, "graph has no series");
    }
    const series = this.series(request, graph, trigger.params.seriesName!);
    if ("status" in series) {
      return series;
    }
    const now = request.deps.clock.now();
    const startDate = new Date(now.getTime() - trigger.params.timePeriod! * 60 * 1000);
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
      timeseriesInput: this.timeseriesInput(
        request.projectId,
        customGraph.filters,
        graph,
        series,
        startDate,
        now,
      ),
    };
  }

  private series(
    request: GraphEvaluationRequest,
    graph: StoredGraphConfig,
    seriesName: string,
  ) {
    const index = parseSeriesIndex(seriesName);
    if (Number.isNaN(index) || index < 0 || index >= graph.series.length) {
      return this.skip(request, `series index ${index} not in graph`);
    }
    const series = graph.series[index];
    if (!series?.name || !series.metric || !series.aggregation) {
      return this.skip(request, "invalid series configuration");
    }
    return series;
  }

  private timeseriesInput(
    projectId: string,
    filters: unknown,
    graph: StoredGraphConfig,
    series: GraphSeries,
    startDate: Date,
    endDate: Date,
  ): TimeseriesInputType {
    return {
      projectId,
      startDate: startDate.getTime(),
      endDate: endDate.getTime(),
      filters: (filters ?? {}) as TimeseriesInputType["filters"],
      series: [{ ...series, name: void 0 }],
      groupBy: graph.groupBy,
      timeScale: graph.timeScale ?? 60,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  private skip(
    request: GraphEvaluationRequest,
    detail: string,
  ): GraphTriggerEvaluationResult {
    return skippedGraphEvaluation({ ...request, detail });
  }
}
