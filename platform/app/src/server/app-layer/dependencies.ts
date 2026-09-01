import type { ClickHouseClient } from "@clickhouse/client";
import type { AgentService } from "@langwatch/agent-contract";
import type {
  WebhookEndpointRuntime,
  WebhookDeliveryService,
  WebhookEventsService,
  WebhookHealthService,
} from "~/runtime/app/features/webhooks";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { AppShutdownResources } from "./app";
import type { WorkerEventingHandoff } from "./worker-eventing-handoff";
import type { RedisConnection } from "@langwatch/redis-client";
import type { PresenceService } from "@langwatch/presence-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { UserService } from "@langwatch/user-contract";
import type { RoleService } from "@langwatch/role-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { ManagedProviderService } from "@langwatch/enterprise-managed-provider-contract";
import type { ScimService } from "@langwatch/enterprise-scim-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type {
  BillableEventsMeterPort,
  BillableEventsRepository as BillingEventsReadRepository,
  BillableEventsQueryService,
  CustomerService,
} from "~/runtime/app/features/billing";
import type Stripe from "stripe";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { AnnotationService } from "@langwatch/annotation-contract";
import type { DashboardService } from "@langwatch/dashboard-contract";
import type { LangWatchQLService } from "~/server/analytics/lwql";
import type { AppCommands } from "~/server/event-sourcing/registration/pipelineRegistry";
import type { FilterService } from "~/server/filters/filter.service";
import type { LicensingApp } from "@langwatch/enterprise-licensing-server";
import type { GatewayApp } from "@langwatch/gateway-server";
import type { GatewayBudgetSpendPort } from "@langwatch/gateway-server";
import type { GatewayChangeEventsPort } from "@langwatch/gateway-server";
import type { GatewayService } from "@langwatch/gateway-server";
import type { GatewayVirtualKeySpendPort } from "@langwatch/gateway-server";
import type { GatewaySpendEventsService } from "@langwatch/gateway-server";
import type { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import type { StoredObjectOwnerResolver } from "@langwatch/stored-object-contract";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import type { AppUserAvatarReadCompatibilityAdapter } from "~/runtime/app/features/user-avatar-read.compatibility.adapter";
import type { NotificationService, NurturingService } from "~/runtime/app/features/billing";
import type { UsageLimitService } from "./billing/enterprise/usage-limit.service";
import type { WebhookService } from "./billing/enterprise/webhook.service";
import type { ClickHouseClientResolver } from "../clickhouse/clickhouseClient";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { ExperimentService } from "@langwatch/experiment-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type {
  ScenarioExecutionService,
  ScenarioService,
  ScenarioTabRegistry,
} from "@langwatch/scenario-contract";
import type { ScenarioExecutionPoolService } from "@langwatch/scenario-server";
import type { SuiteService } from "@langwatch/suite-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import type { ExportService } from "../export/export.service";
import type { OpsExplainService } from "../ops/opsExplain.service";
import type { TraceEditOverlayService } from "../traces/edit-overlay/traceEditOverlay.service";
import type { AutomationService } from "@langwatch/automation-contract";
import type { BroadcastService } from "./broadcast/broadcast.service";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import type { CodingAgentScopePorts } from "@langwatch/coding-agent-server";
import type { AppConfig } from "./config";
import type { GithubService } from "@langwatch/github-contract";
import type { LangyService } from "@langwatch/langy-contract";
import type { OpsService, OpsSnapshotService } from "@langwatch/ops-contract";
import type { EventExplorerService } from "./ops/event-explorer.service";
import type { ManagerExplorerService } from "./ops/manager-explorer.service";
import type { OpsMetricsCollector } from "./ops/metrics-collector";
import type { ReplayService } from "./ops/replay.service";
import type { OrganizationService } from "./organizations/organization.service";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import type { PlanProvider } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import type { LogRecordStorageService } from "./traces/log-record-storage.service";
import type { LogRequestCollectionService } from "./traces/log-request-collection.service";
import type { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import type { SessionGroupsService } from "./traces/session-groups.service";
import type { SpanStorageService } from "./traces/span-storage.service";
import type { TokenizerService } from "./traces/tokenizer.service";
import type { TraceListService } from "./traces/trace-list.service";
import type { TraceIngestionService } from "@langwatch/trace-server";
import type { TraceSummaryService } from "./traces/trace-summary.service";
import type { UsageService } from "./usage/usage.service";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  TraceCanonicalisationService,
  TraceService as TraceTreeService,
} from "@langwatch/trace-contract";
import type { TraceService as TraceReadService } from "../traces/trace.service";
import type { PromptService } from "@langwatch/prompt-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { TopicService } from "@langwatch/topic-contract";
import type { NlpLambdaRuntime } from "~/runtime/api/nlp-lambda";
import type { EmailDeliveryPort } from "../mailer/providers/types";
import type { AuthService } from "@langwatch/auth-contract";
import type { Auth as BetterAuth } from "../better-auth";

export type DataRetentionDependencies = DataRetentionService;

export type OpsDependencies = OpsService & {
  eventExplorer: EventExplorerService;
  managerExplorer: ManagerExplorerService;
  replay: ReplayService;
  /**
   * The lease-elected snapshot writer. Present on every pod that can reach
   * Redis, but only scans on the pod currently holding the lease (ADR-090).
   */
  metricsCollector: OpsMetricsCollector | null;
  /** Reads, writes, and streams the process-owned shared snapshot. */
  snapshots: OpsSnapshotService | null;
};

export interface AppDependencies {
  config: AppConfig;
  /** Process-owned NLP dispatch capability for API and worker transports. */
  nlpLambda: NlpLambdaRuntime;
  /** One process-owned Agent capability shared by every transport. */
  agents: AgentService;
  /** One process-owned Dataset capability shared by REST, tRPC, and workers. */
  dataset: DatasetService;
  /** One process-owned Annotation capability shared by REST, tRPC, and Trace. */
  annotations: AnnotationService;
  /** One process-owned API-key capability; transports must reuse this instance. */
  apiKeys: ApiKeyService;

  managedProviders: ManagedProviderService;
  scim: ScimService;
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
    canonicalisation: TraceCanonicalisationService;
    /** One process-owned legacy trace read service shared by every transport. */
    read: TraceReadService;
    /** One process-owned export facade over the legacy trace reader. */
    export: ExportService;
    /** The feature-owned viewer-safe, cursor-paged span tree. */
    tree: TraceTreeService;
    summary: TraceSummaryService;
    list: TraceListService;
    /** Sessions lens: server-side per-conversation rollups (specs/traces-v2/sessions-lens.feature). */
    sessionGroups: SessionGroupsService;
    spans: SpanStorageService;
    logRecords: LogRecordStorageService;
    collection: TraceIngestionService;
    logCollection: LogRequestCollectionService;
    metricCollection: MetricRequestCollectionService;
    /** Reviewer corrections applied over a captured trace at read time. */
    editOverlay: TraceEditOverlayService;
  };
  /** One process-owned Evaluation capability shared by transports and workers. */
  evaluations: EvaluationService;
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
  /** One process-owned Topic capability shared by reads and transports. */
  topics: TopicService;
  /**
   * The gateway's ClickHouse-backed repositories. Undefined on a deployment
   * without ClickHouse, where the budget service falls back to Postgres.
   *
   * Repositories rather than a service because the surfaces above them
   * genuinely differ - some build a `GatewayService` around the budget
   * ledger, others read virtual-key spend directly. What they must not do is
   * each construct their own, which is the duplication this replaces.
   */
  gateway: {
    /** The one process-owned virtual-key read/write capability. */
    virtualKeys: VirtualKeyService;
    /** The one process-owned gateway budget decision service. */
    budgetDecisions: GatewayService;
    budgets: GatewayBudgetSpendPort | undefined;
    changes: GatewayChangeEventsPort;
    virtualKeySpend: GatewayVirtualKeySpendPort | undefined;
    /** Reconciliation reads for the spend-events pull API and its tRPC
     *  ledger-screen counterpart (ADR-072). */
    spendEvents: GatewaySpendEventsService | undefined;
    /** The process-owned emitted-events capability shared by REST and replay. */
    webhookEvents: WebhookEventsService | undefined;
    /** Endpoint mutation/read capability constructed once with the process store. */
    webhookEndpoints: WebhookEndpointRuntime;
    /** Endpoint delivery health capability sharing the same durable process store. */
    webhookHealth: WebhookHealthService;
    /** The process-owned delivery/outbox capability for replay and intent execution. */
    webhookDelivery: WebhookDeliveryService | undefined;
  };
  /**
   * The Gateway feature's application — what all seven of its doors are given.
   *
   * A port rather than something the App builds for itself. Its checks reach
   * `server/gateway/virtualKey.authz`, which imports
   * `server/app-layer/permissions/imperative`, which value-imports `getApp`
   * from `app-layer/app.ts`: composing it there would put a cycle back through
   * that module into every backend process's graph. Same reason
   * {@link AppDependencies.codingAgentScope} is a port.
   *
   * The two type arguments are the shapes this process owns and the feature
   * package cannot name. They are pinned here rather than left `unknown` so a
   * tRPC router built over the application keeps them on its wire contract.
   */
  gatewayApp: GatewayApp;
  /**
   * The Licensing feature's application, which its two tRPC transports read
   * off the request context rather than take as ports.
   */
  licensingApp: LicensingApp;
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
    resolveOrganizationClient: (organizationId: string) => Promise<ClickHouseClient>;
    /** Every configured instance - shared plus private - for fleet sweeps
     *  and admin surfaces that legitimately touch all of them. */
    allInstances: () => Promise<Array<{ target: string; client: ClickHouseClient }>>;
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
    events: BillableEventsMeterPort;
  };
  /**
   * Governance's OCSF SIEM-export sink (`governance_ocsf_events`). One
   * repository for both directions — the puller worker, the workspace-view
   * audit trail and the subscriber sync write through it; the SIEM export
   * procedure reads through it. Undefined on a deployment without
   * ClickHouse.
   */
  /** The one process-owned Enterprise Governance capability. */
  governance: GovernanceService;
  /** Billing-month usage rollups (billable_events + trace_summaries) behind
   *  `billableEventsQuery.ts`'s exported query functions. */
  billableEvents: BillingEventsReadRepository | undefined;
  billingQueries: BillableEventsQueryService;
  /** ADR-056: the canonical coding-agent session aggregate. */
  codingAgents: CodingAgentService;
  /**
   * The two process directory reads the coding-agent application makes: the
   * organization behind a project, and one caller's cut over that
   * organization's projects.
   *
   * A port rather than something the App builds for itself, because both
   * resolvers live under `server/organizations/**` and one of them reaches
   * `server/api/rbac` — importing either here would put a cycle back through
   * this module into every backend process's graph.
   */
  codingAgentScope: CodingAgentScopePorts;
  /**
   * The organization's GitHub connection, consumed by Langy for writes and by
   * pull-request linkage for reads.
   */
  github: GithubService;
  storedObjects: StoredObjectsService;
  /** Canonical-first User avatar reads with a bounded historical fallback. */
  userAvatarObjects: AppUserAvatarReadCompatibilityAdapter;
  /** The cross-tenant first step for historical file URLs without a project id. */
  storedObjectOwners: StoredObjectOwnerResolver;
  /** The operator-only `/api/ops/clickhouse/explain` endpoint's service —
   *  no tenant scoping, by design (see the repository's own doc comment).
   *  A service rather than the repository it reads, so the route calls a
   *  service like every other route does. */
  opsExplain: {
    service: OpsExplainService;
  };
  /** ADR-046: Langy conversations as an event-sourced projection. */
  langy: LangyService;
  /** The process's one feature flag service (ADR-001, feature-flag). */
  featureFlags: FeatureFlagService;
  experiments: ExperimentService;
  scenarios: ScenarioService;
  scenarioTabs: ScenarioTabRegistry;
  scenarioExecution: ScenarioExecutionService;
  /** Worker-owned pool, composed once before the Simulation pipeline mounts. */
  scenarioExecutionPool: ScenarioExecutionPoolService | null;
  suites: SuiteService;
  automation: AutomationService;
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
  /** One process-owned outbound mail delivery capability. */
  mailer: EmailDeliveryPort;
  /** One process-owned browser session lifecycle capability. */
  auth: AuthService;
  /** The Better Auth transport composed over the lifecycle and mailer. */
  betterAuth: BetterAuth;
  nurturing?: NurturingService;
  usageLimits: UsageLimitService;
  dataRetention: DataRetentionDependencies;
  share: ShareService;
  commands: AppCommands;
  ops: OpsDependencies;

  /**
   * What a packaged worker composition needs to mount the same eventing graph
   * on a second runtime in this process. Present on worker-capable roles only.
   */
  workerEventingHandoff?: WorkerEventingHandoff;

  /** Internal — keeps EventSourcing infrastructure alive for GC. */
  _eventSourcing?: EventSourcing;

  /** Internal — the package-owned AuthZ migration installed by the runtime. */
  _authzMigration?: SystemMigration;

  /** Internal — process resources owned and closed by App. */
  _shutdownResources?: AppShutdownResources;
}
