import type { ClickHouseClient } from "@clickhouse/client";
import type Stripe from "stripe";
import type { AnalyticsService } from "~/server/app-layer/analytics/analytics.service";
import type { BillableEventsRepository } from "~/server/event-sourcing/projections/global/repositories/billable-events.clickhouse.repository";
import type { FilterService } from "~/server/filters/filter.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { GatewayVirtualKeySpendRepository } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import type { OrphanedRunFinder } from "~/server/scenarios/orphaned-run-reconciliation";
import type { NotificationService } from "../../../ee/billing/notifications/notification.service";
import type { UsageLimitService } from "../../../ee/billing/notifications/usage-limit.service";
import type { NurturingService } from "../../../ee/billing/nurturing/nurturing.service";
import type { WebhookService } from "../../../ee/billing/services/webhookService";
import type { ClickHouseClientResolver } from "../clickhouse/clickhouseClient";
import type { StorageMeterService } from "../data-retention/metering/storageMeter.service";
import type { PinnedTraceService } from "../data-retention/pinning/pinnedTrace.service";
import type { DataRetentionPolicyService } from "../data-retention/policy/dataRetentionPolicy.service";
import type { RetentionPolicyCache } from "../data-retention/retentionPolicyCache";
import type { RetroactiveUpdateService } from "../data-retention/retroactive/retroactiveUpdate.service";
import type { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import type { ExperimentService } from "../experiments/experiment.service";
import type { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import type { EmailSuppressionService } from "./automations/emailSuppression.service";
import type { TriggerService } from "./automations/trigger.service";
import type {
  TestFireResult,
  TestFireTriggerInput,
} from "./automations/trigger-template.service";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { CodingAgentSessionService } from "./coding-agent/coding-agent-session.service";
import type { AppConfig } from "./config";
import type { DspyStepService } from "./dspy-steps/dspy-step.service";
import type { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import type { EvaluationRunService } from "./evaluations/evaluation-run.service";
import type { MonitorPerformanceService } from "./evaluations/monitor-performance.service";
import type { LangyCredentialService } from "./langy/LangyCredentialService";
import type { LangyConversationService } from "./langy/langy-conversation.service";
import type { LangyFeedbackPromptService } from "./langy/langy-feedback-prompt.service";
import type { LangyGithubInstallationsService } from "./langy/langy-github-installations.service";
import type { LangyMessageService } from "./langy/langy-message.service";
import type { LangyTurnService } from "./langy/langy-turn.service";
import type { BlobStoreService } from "./ops/blob-store.service";
import type { EventExplorerService } from "./ops/event-explorer.service";
import type { ManagerExplorerService } from "./ops/manager-explorer.service";
import type { OpsMetricsCollector } from "./ops/metrics-collector";
import type { QueueService } from "./ops/queue.service";
import type { ReplayService } from "./ops/replay.service";
import type { SchedulerOpsService } from "./ops/scheduler-ops.service";
import type { OrganizationService } from "./organizations/organization.service";
import type { PresenceService } from "./presence/presence.service";
import type { ProjectService } from "./projects/project.service";
import type { ShareService } from "./share/share.service";
import type { SharedTracePayloadCache } from "./share/shared-trace-cache.service";
import type { SimulationRunService } from "./simulations/simulation-run.service";
import type { PlanProvider } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { SuiteRunService } from "./suites/suite-run.service";
import type { TopicService } from "./topic-clustering/topic.service";
import type { TopicClusteringStatusService } from "./topic-clustering/topic-clustering-status.service";
import type { LogRecordStorageService } from "./traces/log-record-storage.service";
import type { LogRequestCollectionService } from "./traces/log-request-collection.service";
import type { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { TraceListService } from "./traces/trace-list.service";
import type { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { UsageService } from "./usage/usage.service";

export interface DataRetentionDependencies {
  policy: DataRetentionPolicyService;
  pinning: PinnedTraceService;
  retroactive: RetroactiveUpdateService;
  metering: StorageMeterService;
}

export interface OpsDependencies {
  queues: QueueService;
  scheduler: SchedulerOpsService;
  eventExplorer: EventExplorerService;
  managerExplorer: ManagerExplorerService;
  replay: ReplayService;
  blobStore: BlobStoreService;
  metricsCollector: OpsMetricsCollector | null;
}

export interface AppDependencies {
  config: AppConfig;

  broadcast: BroadcastService;
  presence: PresenceService;

  traces: {
    summary: TraceSummaryService;
    list: TraceListService;
    spans: SpanStorageService;
    logRecords: LogRecordStorageService;
    collection: TraceRequestCollectionService;
    logCollection: LogRequestCollectionService;
    metricCollection: MetricRequestCollectionService;
  };
  evaluations: {
    runs: EvaluationRunService;
    execution: EvaluationExecutionService;
    performance: MonitorPerformanceService;
  };
  dspySteps: {
    steps: DspyStepService;
  };
  /**
   * Agent 4 batch (analytics / automations / evaluations / workers ClickHouse
   * access migration). The ADR-034 read API, built once in presets.ts and
   * handed out here instead of each of its ~6 callers (routers, REST apps,
   * the graph-trigger dispatch closure) constructing — and each resolving a
   * ClickHouse client — its own.
   */
  analytics: {
    service: AnalyticsService;
  };
  simulations: {
    runs: SimulationRunService;
    /**
     * CSV export of run history. A sibling of `runs` rather than a method on
     * it: the export sweeps with its own keyset pagination and serializers,
     * and the API layer should reach it here instead of assembling one from
     * `runs.repository`.
     */
    export: ScenarioRunExportService;
  };
  suiteRuns: {
    runs: SuiteRunService;
  };
  /**
   * ADR-051 §7: read side of topic clustering. The commands live on
   * `commands.topicClustering` and are merged onto the same `app.topicClustering`
   * facade, so callers get status reads and clustering requests from one place.
   */
  topicClustering: {
    status: TopicClusteringStatusService;
    topics: TopicService;
  };
  /**
   * The gateway's ClickHouse-backed repositories. Undefined on a deployment
   * without ClickHouse, where the budget service falls back to Postgres.
   *
   * Repositories rather than a service because the surfaces above them
   * genuinely differ - some build a `GatewayBudgetService` around the budget
   * ledger, others read virtual-key spend directly. What they must not do is
   * each construct their own, which is the duplication this replaces.
   */
  gateway: {
    budgets: GatewayBudgetClickHouseRepository | undefined;
    virtualKeySpend: GatewayVirtualKeySpendRepository | undefined;
  };
  /** The values a filter can offer, read from the trace store. */
  filters: {
    options: FilterService;
  };
  /**
   * The canonical per-tenant ClickHouse resolver, identical to the closure
   * `presets.ts` uses to build every other repository. Exposed so the few
   * call sites outside the composition root that build their own
   * ClickHouse-backed repository (replay, the opt-in blob-resolution path)
   * share the resolution policy instead of re-deriving it.
   */
  clickhouse: {
    enabled: boolean;
    resolveClient: ClickHouseClientResolver;
  };
  /** Deduplicated usage counters written to ClickHouse for billing. */
  billing: {
    events: BillableEventsRepository;
  };
  /**
   * Cross-tenant boot-sweep dependencies for the two orphaned-run
   * reconciliation sweeps (QUEUED and IN_PROGRESS). Null when ClickHouse is
   * not configured, in which case both sweeps no-op.
   */
  scenarios: {
    orphanReconciliation: {
      client: ClickHouseClient | null;
      finder: OrphanedRunFinder | null;
    };
  };
  /** ADR-056: read side of the coding-agent session aggregate. */
  codingAgents: {
    sessions: CodingAgentSessionService;
  };
  /** ADR-046: Langy conversations as an event-sourced projection. */
  langy: {
    conversations: LangyConversationService;
    turns: LangyTurnService;
    messages: LangyMessageService;
    githubInstallations: LangyGithubInstallationsService;
    credentials: LangyCredentialService;
    feedbackPrompt: LangyFeedbackPromptService;
  };
  experiments: ExperimentService;
  triggers: TriggerService;
  /** Wraps `testFireTrigger(deps, input)` with the composition-time
   *  `{baseHost, notifier}` bag already bound — the router only needs
   *  to pass the per-call input. */
  triggerTemplates: {
    testFire: (input: TestFireTriggerInput) => Promise<TestFireResult>;
  };
  emailSuppressions: EmailSuppressionService;
  organizations: OrganizationService;
  projects: ProjectService;
  tokenizer: TokenizerService;
  usage: UsageService;
  planProvider: PlanProvider;
  subscription?: SubscriptionService;
  /** Only present in SaaS — dispatches Stripe webhook events. */
  webhookService?: WebhookService;
  /** Only present in SaaS — Stripe client used by the webhook transport to
   *  verify signatures before handing events to the service. */
  stripeClient?: Stripe;
  notifications: NotificationService;
  nurturing?: NurturingService;
  usageLimits: UsageLimitService;
  retentionPolicyCache: RetentionPolicyCache;
  dataRetention: DataRetentionDependencies;
  share: ShareService;
  sharedTraceCache: SharedTracePayloadCache;
  commands: AppCommands;
  ops?: OpsDependencies;

  /** Internal — keeps EventSourcing infrastructure alive for GC. */
  _eventSourcing?: EventSourcing;

  /** Internal — resources to gracefully close on shutdown. */
  _gracefulCloseables?: Array<{ name: string; close: () => Promise<void> }>;
}
