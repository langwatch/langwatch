import type {
  CustomGraph,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  Trigger,
} from "@langwatch/automation-contract";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { TimeseriesBucket } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  AutomationDispatchErrorPort,
  AutomationGraphNotifierPort,
  AutomationGraphTelemetryPort,
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
  telemetry: AutomationGraphTelemetryPort;
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
