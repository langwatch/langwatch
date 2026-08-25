import type { ClickHouseClient } from "@clickhouse/client";
import type { AgentService } from "@langwatch/agent-contract";
import type { WebhookEventsClickHouseRepository } from "~/runtime/app/features/webhooks";
import type {
  AuthzGrantsService,
  AuthzService,
} from "@langwatch/authz-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";
import type { PresenceService } from "@langwatch/presence-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { UserService } from "@langwatch/user-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type {
  GovernanceAiToolCatalogService,
  GovernanceAdminWorkspaceViewAuditService,
  GovernanceCliBootstrapService,
  GovernanceCliSessionInventoryService,
  GovernanceCliTokenRevocationService,
  GovernanceIngestionKeyService,
  GovernanceOttlGateway,
  GovernancePolicyService,
  GovernanceIngestionSourceService,
  GovernanceActivityMonitorService,
  GovernanceOcsfExportService,
  GovernancePersonalVirtualKeyService,
  GovernancePersonalUsageService,
  GovernanceQuarantineFillService,
  GovernanceRoutingPolicyService,
  GovernanceSetupStateService,
  IngestionTemplatesService,
} from "@langwatch/enterprise-governance-contract";
import type { CanonicalCostExtractorService } from "@langwatch/enterprise-governance-server";
import type {
  BillableEventsRepository as BillingEventsReadRepository,
  BillableEventsQueryService,
  CustomerService,
} from "~/runtime/app/features/billing";
import type Stripe from "stripe";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { DashboardService } from "@langwatch/dashboard-contract";
import type { LangWatchQLService } from "~/server/analytics/lwql";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import type { BillableEventsRepository } from "~/server/event-sourcing/registration/global/repositories/billable-events.clickhouse.repository";
import type { AppCommands } from "~/server/event-sourcing/registration/pipelineRegistry";
import type { FilterService } from "~/server/filters/filter.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import type { GatewayBudgetService } from "~/server/gateway/budget.service";
import type { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import type { GatewayVirtualKeySpendRepository } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import type { StoredObjectOwnerClickHouseRepository } from "~/server/stored-objects/repositories/stored-object-owner.clickhouse.repository";
import type { NotificationService, NurturingService } from "~/runtime/app/features/billing";
import type { UsageLimitService } from "./billing/enterprise/usage-limit.service";
import type { WebhookService } from "./billing/enterprise/webhook.service";
import type { GovernanceKpisClickHouseRepository } from "~/runtime/app/features/governance/governance-kpis.clickhouse.repository";
import type { GovernanceOcsfEventsClickHouseRepository } from "~/runtime/app/features/governance/governance-ocsf-events.clickhouse.repository";
import type { GovernanceTraceActivityClickHouseRepository } from "~/runtime/app/features/governance/governance-trace-activity.clickhouse.repository";
import type { ClickHouseClientResolver } from "../clickhouse/clickhouseClient";
import type { StorageMeterService } from "../data-retention/metering/storageMeter.service";
import type { PinnedTraceService } from "../data-retention/pinning/pinnedTrace.service";
import type { DataRetentionPolicyService } from "../data-retention/policy/dataRetentionPolicy.service";
import type { RetentionPolicyCache } from "../data-retention/retentionPolicyCache";
import type { RetroactiveUpdateService } from "../data-retention/retroactive/retroactiveUpdate.service";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import type { SuiteService } from "@langwatch/suite-contract";
import type { SimulationService } from "@langwatch/simulation-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import type { OpsExplainService } from "../ops/opsExplain.service";
import type { TraceEditOverlayService } from "../traces/edit-overlay/traceEditOverlay.service";
import type { AutomationService } from "@langwatch/automation-contract";
import type {
  TestFireResult,
  TestFireTriggerInput,
} from "./automations/trigger-template.service";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { CodingAgentSessionService } from "./coding-agent/coding-agent-session.service";
import type { CodingAgentSessionsListService } from "./coding-agent/coding-agent-sessions-list.service";
import type { PullRequestUsageService } from "./coding-agent/pull-request-usage.service";
import type { AppConfig } from "./config";
import type { DspyStepService } from "./dspy-steps/dspy-step.service";
import type { GithubService } from "@langwatch/github-contract";
import type { LangyService } from "@langwatch/langy-contract";
import type { BlobStoreService } from "./ops/blob-store.service";
import type { EventExplorerService } from "./ops/event-explorer.service";
import type { ManagerExplorerService } from "./ops/manager-explorer.service";
import type { OpsMetricsCollector } from "./ops/metrics-collector";
import type { QueueService } from "./ops/queue.service";
import type { ReplayService } from "./ops/replay.service";
import type { SchedulerOpsService } from "./ops/scheduler-ops.service";
import type { OpsSnapshotReader } from "./ops/snapshot/snapshot-reader";
import type { OrganizationService } from "./organizations/organization.service";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "./share/share.service";
import type { SharedTracePayloadCache } from "./share/shared-trace-cache.service";
import type { PlanProvider } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { SuiteRunService } from "./suites/suite-run.service";
import type {
  ClusteringPageOutcome,
  ClusteringRunContext,
} from "./topic-clustering/clustering";
import type { TopicService } from "./topic-clustering/topic.service";
import type { TopicClusteringStatusService } from "./topic-clustering/topic-clustering-status.service";
import type { LogRecordStorageService } from "./traces/log-record-storage.service";
import type { LogRequestCollectionService } from "./traces/log-request-collection.service";
import type { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import type { SessionGroupsService } from "./traces/session-groups.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { TraceListService } from "./traces/trace-list.service";
import type { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { UsageService } from "./usage/usage.service";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { MonitorService } from "@langwatch/monitor-contract";

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
  /**
   * The lease-elected snapshot writer. Present on every pod that can reach
   * Redis, but only scans on the pod currently holding the lease (ADR-090).
   */
  metricsCollector: OpsMetricsCollector | null;
  /** Serves the shared snapshot to this pod's dashboard subscribers. */
  snapshotReader: OpsSnapshotReader | null;
}

export interface AppDependencies {
  config: AppConfig;
  /** One process-owned Agent capability shared by every transport. */
  agents: AgentService;
  /** One process-owned Dataset capability shared by REST, tRPC, and workers. */
  dataset: DatasetService;
  /** One process-owned API-key capability; transports must reuse this instance. */
  apiKeys: ApiKeyService;

  managedProviders: ManagedProviderService;
  /** One process-owned Model Provider capability shared by all transports. */
  modelProviders: ModelProviderService;
  /** One process-owned Prompt capability shared by REST, tRPC and workers. */
  prompts: PromptService;
  /** One process-owned Evaluator capability shared by REST, tRPC and workers. */
  evaluators: EvaluatorService;
  /** One process-owned Workflow capability shared by REST, tRPC and workers. */
  workflows: WorkflowService;
  /** One process-owned Monitor capability shared by REST, tRPC and workers. */
  monitors: MonitorService;

  broadcast: BroadcastService;
  presence: PresenceService;
  secrets: SecretService;

  traces: {
    summary: TraceSummaryService;
    list: TraceListService;
    /** Sessions lens: server-side per-conversation rollups (specs/traces-v2/sessions-lens.feature). */
    sessionGroups: SessionGroupsService;
    spans: SpanStorageService;
    logRecords: LogRecordStorageService;
    collection: TraceRequestCollectionService;
    logCollection: LogRequestCollectionService;
    metricCollection: MetricRequestCollectionService;
    /** Reviewer corrections applied over a captured trace at read time. */
    editOverlay: TraceEditOverlayService;
  };
  /** One process-owned Evaluation capability shared by transports and workers. */
  evaluations: EvaluationService;
  dspySteps: {
    steps: DspyStepService;
  };
  /**
   * The ADR-034 analytics read API, built once in presets.ts and
   * handed out here instead of each of its ~6 callers (routers, REST apps,
   * the graph-trigger dispatch closure) constructing — and each resolving a
   * ClickHouse client — its own.
   */
  analytics: AnalyticsService;
  /** One process-owned restricted SQL service and its ClickHouse connection pool. */
  langWatchQL: LangWatchQLService;
  /** One process-owned Dashboard capability for dashboard, graph and saved-chart lifecycle. */
  dashboard: DashboardService;
  /** One process-owned Simulation capability for reads and execution. */
  simulations: SimulationService;
  /** API-specific CSV composition over the canonical Simulation service. */
  simulationExports: ScenarioRunExportService;
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
    /**
     * One clustering page, already bound to the composition root's ClickHouse
     * resolver. Callers outside the event-sourcing runtime take the page from
     * here instead of resolving a client of their own.
     */
    runPage: (params: {
      projectId: string;
      searchAfter?: [number, string];
      runContext?: ClusteringRunContext;
    }) => Promise<ClusteringPageOutcome>;
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
    /** The one process-owned member budget read service. */
    budgetOverview: BudgetOverviewService;
    /** The one process-owned gateway budget decision service. */
    budgetDecisions: GatewayBudgetService;
    budgets: GatewayBudgetClickHouseRepository | undefined;
    virtualKeySpend: GatewayVirtualKeySpendRepository | undefined;
    /** Reconciliation reads for the spend-events pull API and its tRPC
     *  ledger-screen counterpart (ADR-072). */
    spendEvents: GatewaySpendEventsRepository | undefined;
    /** The webhook platform's emitted-events log (`gateway_spend` read
     *  through the webhook envelope shape), shared by the REST events
     *  list/get endpoints and spend-events replay. */
    webhookEvents: WebhookEventsClickHouseRepository | undefined;
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
    /** Per-organization resolution, for aggregates keyed by organization
     *  rather than project (usage rollups, the grants ledger). */
    resolveOrganizationClient: (
      organizationId: string,
    ) => Promise<ClickHouseClient>;
    /** Every configured instance - shared plus private - for fleet sweeps
     *  and admin surfaces that legitimately touch all of them. */
    allInstances: () => Promise<
      Array<{ target: string; client: ClickHouseClient }>
    >;
  };
  /**
   * The process's one Redis connection, owned by the composition root and
   * closed with the App (ADR-093).
   *
   * `null` when this deployment or test run configures no Redis — a supported
   * outcome, not an error: consumers branch on it to take their documented
   * fallback (an in-memory counter, a skipped dedupe, an uncached read).
   *
   * Prefer taking a connection as a constructor dependency. Read it from here
   * only where there is no seam to inject through — a route module or a tRPC
   * router — and read it *inside the handler*, never at module scope.
   *
   * Most such readers go through `tryGetApp()` rather than `getApp()`, because
   * they already branch on absence and treat "no App" the same as "no Redis".
   * See ADR-093 for which ones deliberately do not.
   */
  redis: RedisConnection | null;
  /** Deduplicated usage counters written to ClickHouse for billing. */
  billing: {
    events: BillableEventsRepository;
  };
  /** Org-wide counts for the self-hosted daily usage telemetry sender.
   *  Organization-keyed rather than tenant-keyed, like `billing.events`. */
  usageStats: {
    instance: InstanceUsageStatsRepository;
  };
  /**
   * Governance's OCSF SIEM-export sink (`governance_ocsf_events`). One
   * repository for both directions — the puller worker, the workspace-view
   * audit trail and the subscriber sync write through it; the SIEM export
   * procedure reads through it. Undefined on a deployment without
   * ClickHouse.
   */
  governance: {
    /** The process-owned Governance activity read service. */
    activity: GovernanceActivityMonitorService;
    /** The process-owned template catalogue and authoring service. */
    ingestionTemplates: IngestionTemplatesService;
    /** The process-owned ingestion-source lifecycle and secret service. */
    ingestionSources: GovernanceIngestionSourceService;
    /** Process-owned Governance persona/setup detection. */
    setupState: GovernanceSetupStateService;
    /** Process-owned, cursor-paginated OCSF export. */
    ocsfExport: GovernanceOcsfExportService;
    /** Process-owned OTTL validation and transformation gateway. */
    ottlGateway: GovernanceOttlGateway;
    /** Process-owned bundled-versus-billable source policy. */
    policy: GovernancePolicyService;
    /** Canonical usage extraction shared by every Governance receiver. */
    canonicalCostExtractor: CanonicalCostExtractorService;
    ocsfEvents: GovernanceOcsfEventsClickHouseRepository | undefined;
    /** Governance-domain reads over the shared `trace_summaries` table —
     *  the persona-detection activity probe and the quarantine-fill
     *  per-source breakdown. */
    traceActivity: GovernanceTraceActivityClickHouseRepository | undefined;
    /** The `governance_kpis` rollup — the spend-spike anomaly evaluator's
     *  current/baseline window comparison. */
    kpis: GovernanceKpisClickHouseRepository | undefined;
    /** The /me dashboard's spend/token/model rollups. */
    personalUsage: GovernancePersonalUsageService;
    routingPolicies: GovernanceRoutingPolicyService;
    personalVirtualKeys: GovernancePersonalVirtualKeyService;
    aiTools: GovernanceAiToolCatalogService;
    cliBootstrap: GovernanceCliBootstrapService;
    cliSessions: GovernanceCliSessionInventoryService;
    cliTokenRevocation: GovernanceCliTokenRevocationService;
    adminWorkspaceViewAudit: GovernanceAdminWorkspaceViewAuditService;
    quarantineFill: GovernanceQuarantineFillService;
    ingestionKeys: GovernanceIngestionKeyService;
  };
  /** Billing-month usage rollups (billable_events + trace_summaries) behind
   *  `billableEventsQuery.ts`'s exported query functions. */
  billableEvents: BillingEventsReadRepository | undefined;
  billingQueries: BillableEventsQueryService;
  /** ADR-056: read side of the coding-agent session aggregate. */
  codingAgents: {
    sessions: CodingAgentSessionService;
    /** The Sessions screen's list, joined to the pull requests each drove. */
    sessionsList: CodingAgentSessionsListService;
    /** What a pull request cost in assistant usage, RBAC-scoped. */
    pullRequestUsage: PullRequestUsageService;
  };
  /**
   * The organization's GitHub connection, consumed by Langy for writes and by
   * pull-request linkage for reads.
   */
  github: GithubService;
  /** Cross-tenant stored-object lookups — the documented, project-filter-free
   *  exception `/api/files/:id` uses to resolve an id's owning project before
   *  every subsequent read switches back to a project-scoped client. */
  storedObjects: {
    crossTenantOwnerLookup: StoredObjectOwnerClickHouseRepository;
  };
  /** The operator-only `/api/ops/clickhouse/explain` endpoint's service —
   *  no tenant scoping, by design (see the repository's own doc comment).
   *  A service rather than the repository it reads, so the route calls a
   *  service like every other route does. */
  opsExplain: {
    service: OpsExplainService;
  };
  /** ADR-046: Langy conversations as an event-sourced projection. */
  langy: LangyService;
  experiments: ExperimentService;
  scenarios: ScenarioService;
  suites: SuiteService;
  automation: AutomationService;
  /** Wraps `testFireTrigger(deps, input)` with the composition-time
   *  `{baseHost, notifier}` bag already bound — the router only needs
   *  to pass the per-call input. */
  triggerTemplates: {
    testFire: (input: TestFireTriggerInput) => Promise<TestFireResult>;
  };
  organizations: OrganizationService;
  projects: ProjectService;
  users: UserService;
  /** The one process-owned custom-role capability. */
  roles: RoleService;
  /**
   * ADR-092 decision 25 — the one permission-checking service. Every grant
   * check on every surface (tRPC declarations, Hono session and API-key
   * middlewares, the management API) resolves THIS instance via
   * `getApp().permissions`; nothing composes its own from a client.
   */
  permissions: AuthzService;
  /** The one grant-mutation capability. Callers never construct its ledger,
   *  cutover, epoch or persistence collaborators themselves. */
  authzGrants: AuthzGrantsService;
  tokenizer: TokenizerService;
  usage: UsageService;
  planProvider: PlanProvider;
  subscription?: SubscriptionService;
  /** Only present in SaaS — owns Stripe customer lookup and creation. */
  billingCustomer?: CustomerService;
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

  /** Internal — the package-owned AuthZ migration installed by the runtime. */
  _authzMigration?: SystemMigration;

  /** Internal — resources to gracefully close on shutdown. */
  _gracefulCloseables?: Array<{ name: string; close: () => Promise<void> }>;
}
