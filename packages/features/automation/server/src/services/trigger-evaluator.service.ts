import type {
  CustomGraph,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  Trigger,
} from "@langwatch/automation-contract";
import { isNoDataPredicate } from "@langwatch/automation-contract";
import { createHash } from "node:crypto";
import type { OpenGraphTriggerSent } from "../repositories/graph-trigger-sent.repository";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { TimeseriesBucket } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationSlackBotTokenDecryptorPort,
} from "../ports/automation-graph.port";
import type { AutomationClock } from "../ports/automation-clock.port";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository";
import type { TriggerRepository } from "../repositories/trigger.repository";

export type GraphActionParams = {
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

export type TimeseriesFilterValue =
  | string[]
  | Record<string, string[]>
  | Record<string, Record<string, string[]>>;

export type TimeseriesPipeline = {
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

export type TimeseriesResult = {
  previousPeriod: TimeseriesBucket[];
  currentPeriod: TimeseriesBucket[];
};

export type TimeseriesReadOptions = { maxResultRows?: number };

export type StoredGraphConfig = {
  series: GraphSeries[];
  groupBy?: string;
  groupByKey?: string;
  timeScale?: "full" | number;
};

export type GraphTriggerEvaluationDeps = {
  triggers: TriggerRepository;
  customGraphs: CustomGraphRepository;
  projects: ProjectService;
  analytics: AnalyticsService;
  triggerSent: GraphTriggerSentRepository;
  notifier: AutomationGraphNotifierPort;
  logger: AutomationLoggerPort;
  slackTokens: AutomationSlackBotTokenDecryptorPort;
  dispatchErrors: AutomationDispatchErrorPort;
  clock: AutomationClock;
  baseHost: string;
};

export type ProjectIdentity = {
  id: string;
  name: string;
  slug: string;
};

export type EvaluateGraphTriggerResult = GraphTriggerEvaluationResult;
export type EvaluationReason = GraphTriggerEvaluationReason;

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
  now: Date;
  startDate: Date;
  timeseriesInput: TimeseriesInputType;
};

export type GraphSeriesEvaluation = {
  currentValue: number;
  previousValue: number | null;
  currentPoints: Array<{ timestamp: string; value: number }>;
  previousPoints: Array<{ timestamp: string; value: number }>;
};

export const GRAPH_TRIGGER_MAX_RESULT_ROWS = 10_000;

/** Pure graph-evaluation helpers shared by the focused evaluator services. */
export class TriggerEvaluatorService {
  private constructor() {}

  static create(): TriggerEvaluatorService {
    return new TriggerEvaluatorService();
  }

  static buildGraphSeriesName(series: GraphSeries, index: number): string {
    const aggregation = series.aggregation === "terms" ? "cardinality" : series.aggregation;
    if (series.pipeline) {
      return `${index}/${series.metric}/${aggregation}/${series.pipeline.field}/${series.pipeline.aggregation}`;
    }

    if (series.key) {
      return `${index}/${series.metric}/${aggregation}/${series.key}`;
    }

    return `${index}/${series.metric}/${aggregation}`;
  }

  static isTimeseriesResultTooLarge(error: unknown): boolean {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 396 || code === "396") {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error);

    return message.includes("TOO_MANY_ROWS_OR_BYTES");
  }

  static graphAlertFireDigest(input: {
    triggerId: string;
    customGraphId: string;
    previousFireId: string | null;
  }): string {
    return createHash("sha256")
      .update(`${input.triggerId}:${input.customGraphId}:${input.previousFireId ?? "genesis"}`)
      .digest("hex")
      .slice(0, 16);
  }

  static skippedGraphEvaluation(input: {
    triggerId: string;
    projectId: string;
    reason: EvaluationReason;
    detail: string;
  }): GraphTriggerEvaluationResult {
    return { ...input, status: "skipped" };
  }

  static async resolveGraphIncident(input: {
    deps: GraphTriggerEvaluationDeps;
    openTriggerSent: OpenGraphTriggerSent;
    projectId: string;
    now: Date;
  }): Promise<void> {
    await input.deps.triggerSent.markResolvedById({
      id: input.openTriggerSent.id,
      projectId: input.projectId,
      now: input.now,
    });
  }

  static tryNoDataDetail(operator: string, threshold: number): string | undefined {
    return isNoDataPredicate({ operator, threshold }) ? "no-data predicate" : undefined;
  }
}
