import type { AnalyticsService, TimeseriesBucket } from "@langwatch/analytics-contract";
import type {
  CustomGraph,
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  GraphTriggerSweepCandidate,
  DatasetActionParams,
  SlackPayload,
  Trigger,
  TriggerMatchRecordedEventData,
  TriggerSummary,
  WebhookActionParams,
  WebhookDeliveryInput,
  GraphAlertTemplateContext,
} from "@langwatch/automation-contract";
import type { IntentContext } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";
import type {
  TraceQueryClassification,
  TraceRecord,
  TraceSummaryData,
} from "@langwatch/trace-contract";

import type { AutomationGraphNotifier } from "../channels/automation-graph-alert.channel.ts";
import type { AutomationNotificationDelivery } from "../channels/automation-notification-delivery.channel.ts";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "../eventing/trigger-settlement.intent.ts";
import type { CustomGraphRepository } from "../repositories/custom-graph.repository.ts";
import type { GraphTriggerSentRepository } from "../repositories/graph-trigger-sent.repository.ts";
import type { TriggerRepository } from "../repositories/trigger.repository.ts";
import type { SlackDestinationService } from "../services/slack-destination.service.ts";

// Re-exported: several files in this module still import these names from
// here rather than from where they are actually declared.
export type { AutomationGraphNotifier, AutomationNotificationDelivery, SlackDestinationService };
export interface AutomationClock {
  now(): Instant;
}

export interface AutomationEvaluationTriggerFilter {
  readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean;
}

export interface AutomationTriggerMatchRecorder {
  send(
    input: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/**
 * Trace summary read by evaluation alert subscriber; narrower than full TraceService
 * which carries unused paths.
 */
export interface AutomationEvaluationTraceSummary {
  findSummary(input: { projectId: string; traceId: string }): Promise<TraceSummaryData | null>;
}

/**
 * Whether a saved filter query reads evaluations at all. Synchronous,
 * since classification is a parse of the customer's query text, not a
 * read; narrowed off `TraceService` for the same reason the summary read is.
 */
export interface AutomationEvaluationQueryClassification {
  classifyQuery(input: { query: string }): TraceQueryClassification;
}

/**
 * Two-method port for graph-alert real-time subscriber to avoid circular dependency on
 * full AutomationService; excludes heartbeat and persist-cap methods.
 */
export interface AutomationGraphActivity {
  /**
   * The project's active automations that watch a custom graph. Never a
   * REPORT-kind automation: a report is a schedule, not an alert, and
   * re-evaluating one on trace activity would fire it off calendar.
   */
  getActiveGraphTriggersForProject(projectId: string): Promise<TriggerSummary[]>;

  /**
   * Re-evaluates one graph automation and dispatches an alert if it
   * fired. Idempotent by its own open/resolve bookkeeping, since retry,
   * heartbeat sweep and manual re-run all land here for the same incident.
   */
  evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;
}

/**
 * Project read for graph alerts; narrowing to avoid dragging credentials and authz
 * services into processes that only send alerts.
 */
export interface AutomationProjectDirectory {
  findById(projectId: string): Promise<{
    id: string;
    name: string;
    slug: string;
  } | null>;
}

/**
 * Automation-owned persistence operations used by the host's graph delivery
 * adapter. Keeping this nominal boundary prevents composition from reaching
 * into the process service while it is being constructed.
 */
export interface AutomationGraphDelivery {
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
  isSendClaimed(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean>;
  claimSend(input: { triggerId: string; traceId: string; projectId: string }): Promise<boolean>;
  recordWebhookDelivery(input: WebhookDeliveryInput): Promise<void>;
}

export type GraphAlertDispatchInput = {
  trigger: Trigger;
  project: { id: string };
  context: GraphAlertTemplateContext;
  recipients: string[];
  slackWebhook: string | null;
  botDestination?: { token: string; channel: string } | null;
  fireDigest: string;
};

export type GraphAlertDispatchResult = {
  channel: "email" | "slack" | "webhook" | "none";
  didSend: boolean;
  missingVariables: string[];
  renderErrors: string[];
};

/** Technical delivery boundary owned by the process composition root. */

/** Process logger used by graph evaluation and heartbeat isolation. */

/** Technical ClickHouse resolver used only by the heartbeat recency query. */

/** Host crypto boundary for stored Slack bot credentials. */

/** Host transport semantics for retryable and terminal delivery failures. */

export type AutomationGraphNotifierInput = GraphAlertDispatchInput;

export type AutomationGraphNotifierResult = GraphAlertDispatchResult;

/** Outbound provider calls. Automation owns when and what to send; the process
 * adapter owns SDKs, HTTP policy, mail rendering members, and secrets. */

export type AutomationWebhookStoredParams = {
  url: string;
  method: WebhookActionParams["method"];
  bodyTemplate: string | null;
  contentType?: string;
  headersEncrypted?: string;
  headers?: Record<string, string>;
  signingSecretEncrypted?: string;
  previousSigningSecretEncrypted?: string;
  previousSigningSecretExpiresAt?: number;
};

export type ClaimLease = { key: string; token: string };

export interface TestFireEmail {
  recipients: string[];
  subject: string;
  html: string;
}

export interface TestFireSlackWebhook {
  webhook: string;
  payload: SlackPayload;
}

export interface TestFireSlackBot {
  token: string;
  channel: string;
  payload: SlackPayload;
}

export interface TestFireWebhook {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers: Record<string, string>;
  signingSecrets?: readonly string[];
  body: string;
  triggerName: string;
}

/**
 * Automation listing for trace-alert path; narrows AutomationService to avoid 12
 * collaborators needed for authoring surface.
 */

export interface AutomationEmailCapStore {
  claim(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<"claimed" | "already-claimed">;
  findValue(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  eval(script: string, keyCount: number, key: string, seconds: string): Promise<unknown>;
}

export type UnsubscribeTokenPayload = {
  projectId: string;
  triggerId: string | null;
  email: string;
};

/** The ClickHouse query surface the runaway count reads through. */
export type ClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, string | number>;
    format: "JSONEachRow";
  }): Promise<{ json(): Promise<unknown> }>;
};

/** Process logger used by graph evaluation and heartbeat isolation. */
export abstract class AutomationLogger {
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract debug(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
  abstract warn(fields: Record<string, unknown>, message: string): void;
}

/** Technical ClickHouse resolver used only by the heartbeat recency query. */
export abstract class AutomationHeartbeat {
  abstract findClickHouseClient(projectId: string): Promise<ClickHouseClient | null>;
}

/** Host transport semantics for retryable and terminal delivery failures. */
export abstract class AutomationDispatchError {
  abstract isTerminal(error: unknown): boolean;
  abstract createTerminal(message: string): unknown;
}

export abstract class AutomationScheduledIntent {
  abstract decideGraphTriggerHeartbeat(input: {
    now: Instant;
  }): Promise<GraphTriggerSweepCandidate[]>;

  abstract evaluateGraphTrigger(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult>;

  abstract pruneWebhookDeliveries(now?: Instant): Promise<number>;
}

export abstract class AutomationSettlementExecutor {
  abstract notifyDigest(payload: NotifyDigestIntent, context: IntentContext): Promise<void>;
  abstract persistMatch(payload: PersistMatchIntent, context: IntentContext): Promise<void>;
  abstract logOverflow(payload: LogOverflowIntent, context: IntentContext): Promise<void>;
}

export abstract class AutomationDatasetMapper {
  abstract map(input: {
    trace: TraceRecord;
    mapping: DatasetActionParams["datasetMapping"]["mapping"];
    expansions: readonly string[];
  }): Record<string, string | number>[];
}

/** Telemetry and logging the containment policy reports as it runs. */
export abstract class AutomationRunawaySignals {
  abstract onCeilingBreach(): void;
  abstract onAutoPaused(reason: string): void;
  abstract onContainmentFailed(): void;
  abstract error(fields: Record<string, unknown>, message: string): void;
  abstract info(fields: Record<string, unknown>, message: string): void;
}

/**
 * Three containment observations isolated so composition can use them without
 * satisfying the whole `AutomationRunawayRepository` port; wiring per-root decides OTLP.
 */
export abstract class AutomationRunawayMetricsSink {
  abstract onCeilingBreach(): void;
  abstract onAutoPaused(reason: string): void;
  abstract onContainmentFailed(): void;
}

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
  projects: AutomationProjectDirectory;
  analytics: AnalyticsService;
  triggerSent: GraphTriggerSentRepository;
  notifier: AutomationGraphNotifier;
  logger: AutomationLogger;
  slackDestinations: SlackDestinationService;
  dispatchErrors: AutomationDispatchError;
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
  now: Instant;
  startDate: Instant;
  timeseriesInput: TimeseriesInputType;
};

export type GraphSeriesEvaluation = {
  currentValue: number;
  previousValue: number | null;
  currentPoints: { timestamp: string; value: number }[];
  previousPoints: { timestamp: string; value: number }[];
};

export const GRAPH_TRIGGER_MAX_RESULT_ROWS = 10_000;
