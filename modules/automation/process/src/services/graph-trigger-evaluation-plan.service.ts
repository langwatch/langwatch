import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  type CustomGraph,
  type GraphTriggerEvaluationReason,
  parseSeriesIndex,
  type EvaluationSkipCode,
  type GraphTriggerEvaluationCondition,
  type GraphTriggerEvaluationResult,
  type Trigger,
} from "@langwatch/automation-contract";
import { type Instant } from "@langwatch/time";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import type { AutomationClock } from "../repositories/automation.repositories.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import { skippedGraphEvaluation } from "../rules/trigger-evaluator.rules.ts";
import type { AutomationDispatchError } from "./automation-graph-activity.service.ts";
import type { AutomationLogger, AutomationProjectDirectory } from "./automation.service.ts";
import type { SlackDestinationService } from "./slack-destination.service.ts";
import type { TriggerLatestEvaluationService } from "./trigger-latest-evaluation.service.ts";

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
      // Not the graph's `groupBy`: the threshold is one number, and only the
      // database can compute it across every group (summing per-group values
      // adds averages and counts an array grouping once per group).
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

type GraphActionParams = {
  members?: string[] | null;
  slackWebhook?: string | null;
  threshold?: number;
  operator?: string;
  timePeriod?: number;
  seriesName?: string;
  slackDelivery?: "webhook" | "bot";
  slackBotToken?: string;
  slackChannelId?: string;
  [key: string]: unknown;
};

type TimeseriesFilterValue =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

type TimeseriesPipeline = {
  field: "trace_id" | "user_id" | "thread_id" | "customer_id";
  aggregation: "sum" | "avg" | "min" | "max";
};

export type GraphSeries = {
  name?: string;
  metric: string;
  key?: string;
  subkey?: string;
  aggregation:
    | "terms"
    | "cardinality"
    | "avg"
    | "sum"
    | "min"
    | "max"
    | "median"
    | "p99"
    | "p95"
    | "p90";
  pipeline?: TimeseriesPipeline;
  filters?: Record<string, TimeseriesFilterValue>;
  asPercent?: boolean;
};

export type TimeseriesInputType = {
  projectId: string;
  startDate: number;
  endDate: number;
  query?: string;
  filters: Record<string, TimeseriesFilterValue>;
  traceIds?: string[];
  negateFilters?: boolean;
  series: GraphSeries[];
  groupBy?: string;
  groupByKey?: string;
  timeScale?: "full" | number;
  timeZone: string;
};

type StoredGraphConfig = {
  series: GraphSeries[];
  groupBy?: string;
  groupByKey?: string;
  timeScale?: "full" | number;
};

export type GraphTriggerEvaluationDeps = {
  triggers: TriggerRepository;
  customGraphs: CustomGraphRepository;
  projects: AutomationProjectDirectory;
  analytics: AnalyticsService;
  triggerSent: GraphTriggerSentRepository;
  notifier: AutomationGraphNotifier;
  logger: AutomationLogger;
  slackDestinations: SlackDestinationService;
  dispatchErrors: AutomationDispatchError;
  /** Records what each check observed; never throws, so it cannot suppress an alert. */
  latestEvaluations: Pick<TriggerLatestEvaluationService, "record">;
  clock: AutomationClock;
  baseHost: string;
};

export type ProjectIdentity = {
  id: string;
  name: string;
  slug: string;
};

export type GraphEvaluationRequest = {
  deps: GraphTriggerEvaluationDeps;
  triggerId: string;
  projectId: string;
  reason: GraphTriggerEvaluationReason;
};

export type GraphEvaluationPlan = {
  request: GraphEvaluationRequest;
  trigger: Trigger;
  customGraph: CustomGraph;
  customGraphId: string;
  params: GraphActionParams;
  threshold: number;
  operator: string;
  timePeriod: number;
  seriesName: string;
  series: GraphSeries;
  graph: StoredGraphConfig;
  now: Instant;
  startDate: Instant;
  timeseriesInput: TimeseriesInputType;
};
