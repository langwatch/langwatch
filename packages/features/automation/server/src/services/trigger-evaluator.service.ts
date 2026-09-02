import type {
  CustomGraph,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  Trigger,
} from "@langwatch/automation-contract";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { TimeseriesBucket } from "@langwatch/analytics-contract";
import type { AutomationProjectIdentityPort } from "../ports/automation-graph-activity.port";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationSlackBotTokenDecryptorPort,
} from "../ports/automation-graph.port";
import type { AutomationClockPort } from "../ports/automation-clock.port";
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
  projects: AutomationProjectIdentityPort;
  analytics: AnalyticsService;
  triggerSent: GraphTriggerSentRepository;
  notifier: AutomationGraphNotifierPort;
  logger: AutomationLoggerPort;
  slackTokens: AutomationSlackBotTokenDecryptorPort;
  dispatchErrors: AutomationDispatchErrorPort;
  clock: AutomationClockPort;
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
/**
 * What the graph-trigger collaborators share.
 *
 * Everything else this class held moved to the one service that called it —
 * the series name and the too-large classification to series evaluation, the
 * fire digest and the no-data detail to alert delivery, and the incident
 * resolve was a pass-through its caller could make itself. This is the only
 * member with more than one caller.
 */
export class TriggerEvaluatorService {
  private constructor() {}

  /** A result that stops the evaluation before it reads any data. */
  static skippedGraphEvaluation(input: {
    triggerId: string;
    projectId: string;
    reason: EvaluationReason;
    detail: string;
  }): GraphTriggerEvaluationResult {
    return { ...input, status: "skipped" };
  }
}
