import {
  createEnterpriseWebhookEndpointService,
  installEnterpriseWebhookAccess,
} from "~/server/webhooks/enterpriseWebhookEndpointService";
import {
  SettingsMap,
  TupleParam,
  type ClickHouseClient,
  type ClickHouseSettings,
  type DataFormat,
} from "@clickhouse/client";
import type { PrismaConnection } from "@langwatch/prisma-client";
import {
  REPORT_SCHEDULER_TARGET_TYPE,
  type AutomationService,
} from "@langwatch/automation-contract";
import { resolveFeatureFlagConfig } from "@langwatch/feature-flag-contract";
import {
  PostgresFeatureFlagAdapter,
  RedisFeatureFlagCacheAdapter,
} from "@langwatch/feature-flag-server";
import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
} from "@langwatch/enterprise-billing-contract";
import { resolveGatewayBaseUrl } from "~/runtime/public-config.server";
import {
  BillableEventsQueryService,
  ClickHouseBillingAdapter,
  CustomerService,
  NotificationService,
  NurturingService,
  PostgresBillingAdapter,
  SaaSPlanProviderService,
  SeatEventSubscriptionService,
  StripeClientAdapter,
  StripeCustomerCurrencyService,
  StripeErrorAdapter,
  StripeUsageReportingService,
  SubscriptionItemCalculatorService,
} from "~/runtime/app/features/billing";
import {
  AppGovernanceEventingAdapter,
  AppGovernanceEventingRuntime,
  AppIngestionPullExecutionRuntime,
  AppIngestionPullLifecycleRuntime,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { AppIngestionPullWorkerAdapter } from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import {
  AppGovernanceIngestionPullHost,
  AppGovernanceIngestionPullMetrics,
  AppGovernanceIngestionPullSchedule,
  AppGovernanceModelProviderCatalog,
  AppGovernanceOrganizationContacts,
} from "~/server/app-layer/governance-ingestion-pull.host";
import { AppIngestionSourceAdapter } from "@langwatch/enterprise-api/governance/ingestion-source.adapter";
import { AppIngestionSourceActivityAdapter } from "@langwatch/enterprise-api/governance/ingestion-source-activity.adapter";
import { AppGovernanceKpisAdapter } from "@langwatch/enterprise-api/governance/governance-kpis.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import { AppGovernanceTraceActivityAdapter } from "@langwatch/enterprise-api/governance/governance-trace-activity.adapter";
import { AppPersonalUsageReadAdapter } from "@langwatch/enterprise-api/governance/personal-usage-read.adapter";
import {
  WebhookEventsClickHouseRepository,
  WebhookDeliveryService,
  WebhookEventsService,
  WebhookHealthService,
  type WebhookDeliveryProcessDeps,
} from "~/runtime/app/features/webhooks";
import {
  bindProcessFleetMetricsSource,
  createEventingGroupQueueFactory,
  Deferred,
  EventSourcing,
  InMemoryProcessStore,
  RedisReplayMarkerChecker,
} from "@langwatch/eventing";
import { AppAuditLogRuntime } from "~/runtime/app/features/audit-log";
import { AppApiKeyDiagnostics, AppApiKeyRuntime } from "~/runtime/app/features/api-key";
import {
  AppAutomationClock,
  AppAutomationRuntime,
  createAppAutomationEmailCaps,
  createAppAutomationTestPersistCaps,
} from "~/runtime/app/features/automation";
import { AppGovernanceRuntime } from "@langwatch/enterprise-api/governance/runtime";
import { AppTraceRuntime } from "~/runtime/app/features/trace";
import { createAppTraceSummaryStore } from "~/runtime/app/trace-summary-fold.adapter";
import { AppTraceProjectionStorageAdapter } from "~/runtime/app/trace-projection-storage.adapter";
import { AppTraceQueryFieldValuesAdapter } from "~/runtime/app/features/trace-query-field-values.adapter";
import { AppGatewayGovernancePort } from "@langwatch/enterprise-api";
import { PostgresIngestionPullSourceAdapter } from "@langwatch/enterprise-governance-server";
import { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import { AgentsFeature } from "~/runtime/app/features/agents";
import { AppModelProviderRuntime } from "~/runtime/app/features/model-provider";
import { AppOrganizationRuntime } from "~/runtime/app/features/organization";
import { AppProjectRuntime } from "~/runtime/app/features/project";
import { AppRoleRuntime } from "~/runtime/app/features/role";
import { AppTracePrivacyRuntime } from "~/runtime/app/trace-privacy.runtime";
import { EvaluatorFeature } from "~/runtime/app/features/evaluator";
import {
  AppEvaluationExecutionPort,
  AppEvaluationRuntime,
} from "~/runtime/app/features/evaluation";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
} from "@langwatch/evaluation-server";
import { AppWorkflowNlpRuntimePort, AppWorkflowRuntime } from "~/runtime/app/features/workflow";
import { mappingStateSchema } from "~/server/tracer/tracesMapping";
import {
  AppWorkflowEnvironmentEncryption,
  AppWorkflowLlmParametersPort,
  AppWorkflowProjectEnvironmentPort,
} from "~/runtime/app/features/workflow-studio-enrichment.adapter";
import {
  AppExperimentDspyRetentionPort,
  AppExperimentRuntime,
} from "~/runtime/app/features/experiment";
import { AppExperimentEventingAdapter } from "~/runtime/app/features/experiment-eventing";
import { AppExperimentWorkbenchUpdatesAdapter } from "~/runtime/app/features/experiment-workbench-updates.adapter";
import { AppExperimentRunHistoryObservability } from "~/runtime/app/features/experiment-run-history.observability";
import {
  AppScenarioClock,
  AppScenarioFolderId,
  AppScenarioId,
  AppScenarioRuntime,
  AppScenarioSecretCipher,
} from "~/runtime/app/features/scenario";
import { SCENARIO_WORKER } from "@langwatch/scenario-contract";
import {
  RedisCancellationPublisherAdapter,
  RedisScenarioTabStoreAdapter,
  ScenarioExecutionPoolService,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  ScenarioTabRegistryService,
  UnavailableScenarioExecutionPoolService,
  UnavailableCancellationPublisherAdapter,
} from "@langwatch/scenario-server";
import { AppSimulationRuntime } from "~/runtime/app/features/simulation";
import { PostgresSuiteAdapter, SuiteExecutionService } from "@langwatch/suite-server";
import { AppSuiteRuntime } from "~/runtime/app/features/suite";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import { AppRedisRuntime } from "~/runtime/app/redis.runtime";
import { slugify } from "~/utils/slugify";
import { env } from "~/env.mjs";
import { resolveNlpLambdaRuntimeConfig } from "~/runtime/api/nlp-lambda";
import { createProcessNlpLambdaRuntime } from "~/server/app-layer/nlp-lambda.runtime";
import {
  LangyTurnAccessStore,
  LangyTurnHandoffStore,
  LangyTokenBuffer,
  PostgresLangyAdapter,
  UnavailableLangyWorkerAdapter,
  createLangyWorkerPort,
} from "@langwatch/langy-server";
import { AppLangyWorkerMetricsPort } from "~/runtime/app/features/langy";
import { AuthzFeature } from "~/runtime/app/features/authz";
import { AnalyticsAdapter, LoggingAnalyticsTripwire } from "@langwatch/analytics-server";
import { PostgresAnnotationAdapter } from "@langwatch/annotation-server";
import { PostgresDashboardAdapter } from "@langwatch/dashboard-server";
import { PostgresScimAdapter } from "@langwatch/enterprise-scim-server";
import { getProtectionsForProject } from "~/server/api/utils";
import { validateSavedWorkbenchChartDefinition } from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import {
  createLangWatchQLService,
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
} from "~/server/analytics/lwql";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import {
  LwqlKeyMapClickHouseRepository,
  NullLwqlKeyMapRepository,
} from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { LwqlKeyMapService } from "~/server/analytics/lwql/lwql-key-map.service";
import { sendRenderedSlackMessage } from "~/runtime/app/features/automation-adapters/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/runtime/app/features/automation-adapters/delivery/slackWebApi";
import { AppLangyNavigateFallbackAdapter } from "~/runtime/app/features/langy-navigate-fallback.adapter";
import { resolveLangyCapabilityProgress } from "@langwatch/langy-server/streaming/langy-capability-progress";
import { createAppLangyCredentialComposition } from "~/runtime/app/features/langy-credentials.adapter";
import { AppLangySessionKeyMetricsAdapter } from "~/runtime/app/features/langy-session-key-metrics.adapter";
import { resolveLangyHarness } from "~/runtime/app/features/langy-harness.adapter";
import { renderLangyTurnContext } from "~/runtime/app/features/langy-turn-context.adapter";
import {
  OpsExplainClickHouseRepository,
  OpsExplainClientResolver,
  type OpsExplainClientResolution,
} from "~/server/app-layer/ops/repositories/ops-explain.clickhouse.repository";
import {
  type ClickHouseClientResolver,
  AppClickHouseRuntime,
  configureClickHouseRuntime,
  getAllClickHouseInstances,
  getClickHouseClientForOrganization,
  getClickHouseClientForTenant,
  isClickHouseEnabled,
  _getSharedClickHouseClient,
  shutdownComposedClickHouseRuntime,
} from "~/server/clickhouse/clickhouseClient";
import { createProcessPrismaConnection } from "~/runtime/app/prisma-process.composition";
import {
  adoptPrismaConnection,
  closePrismaConnection,
  configurePrismaConnection,
  getPrismaConnection,
  hasPrismaConnection,
  prisma as globalPrisma,
} from "~/server/db";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  PrismaProcessStore,
} from "@langwatch/eventing/server";
import { BILLING_REPORTING_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/billing-reporting/pipeline";
import type { LangyConversationProcessingEvent } from "@langwatch/langy-server";
import { createBillingMeterDispatchSubscriber } from "~/server/event-sourcing/registration/global/billingMeterDispatch.subscriber";
import { orgBillableEventsMeterProjection } from "~/server/event-sourcing/registration/global/orgBillableEventsMeter.mapProjection";
import { BillableEventsMeterClickHouseRepository } from "~/server/event-sourcing/registration/global/repositories/billable-events.clickhouse.repository";
import type { PipelineRepositories } from "~/server/event-sourcing/registration/pipelineRegistry";
import {
  type AppCommands,
  PipelineRegistry,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import { FilterService } from "~/server/filters/filter.service";
import { PrismaDataPrivacyAdapter } from "@langwatch/data-privacy-server";
import {
  GatewayBudgetLedgerAdapter,
  GatewaySpendEventsClickHouseAdapter,
  GatewaySpendEventsService,
  GatewayVirtualKeySpendAdapter,
  PrismaGatewayAdapter,
} from "@langwatch/gateway-server";
import { createGatewayChangeEventsPort } from "@langwatch/gateway-server/composition/gateway-change-events";
import { createBudgetChangeEventDedupeService } from "~/server/gateway/budgetChangeEventDedupe.service";
import { createProcessVirtualKeyCrypto } from "~/runtime/app/features/gateway-virtual-key-crypto.composition";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { getEdgeSpoolFailOpenCounter, getLangyTurnsCounter } from "~/server/metrics";
import {
  getLangyGithubPrUsage,
  LANGY_GITHUB_PRS_PER_DAY,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { LANGY_CHAT_FEATURE_KEY } from "@langwatch/model-provider-contract";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { OpsExplainService } from "~/server/ops/opsExplain.service";
import { OpsClickHouseRuntime } from "~/server/ops/explain-core";
import { getPostHogInstance } from "~/server/posthog";
import { pruneExpiredIdempotencyReceipts } from "~/server/webhooks/deliveryLog";
import { webhookDestinationFor } from "~/server/webhooks/destinations";
import { resetSqsClientCache } from "~/server/webhooks/destinations/sqsWebhookDestination";
import {
  AppAwsClientConfiguration,
  closeAwsClientConfiguration,
  configureAwsClientConfiguration,
} from "~/runtime/app/aws-client.composition";
import { AppLangevalsRuntime } from "~/runtime/app/langevals.runtime";
import { resolveLangevalsRuntimeConfig } from "~/runtime/langevals.config";
import { configureProcessOutboundProxy } from "~/server/outboundProxy";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { StoredObjectOwnerLookupRuntime } from "@langwatch/stored-object-server";
import { AppStoredObjectOwnerInstanceDirectory } from "~/runtime/app/features/stored-object-owner-instance-directory.adapter";
import { AppStoredObjectOwnerLookupTracingAdapter } from "~/runtime/app/features/stored-object-owner-lookup.tracing.adapter";
import { AppUserAvatarReadCompatibilityAdapter } from "~/runtime/app/features/user-avatar-read.compatibility.adapter";
import { AppUserAvatarStorageInfrastructureAdapter } from "~/runtime/app/features/user-avatar-storage-infrastructure.adapter";
import { createProcessUserAvatarStoredObjectService } from "~/runtime/app/features/user-avatar-stored-object-service.composition";
import { AppUserAvatarStoredObjectStorageAdapter } from "~/runtime/app/features/user-avatar-stored-object-storage.adapter";
import { AppUserRuntimeAdapter } from "~/runtime/app/features/user-runtime.adapter";
import { AppSecretRuntime } from "~/runtime/app/features/secret";
import {
  createStorageRegistry,
  createProcessStoredObjectsService,
} from "~/server/stored-objects/stored-objects-factory";
import { captureException } from "~/utils/posthogErrorCapture";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { KSUID_RESOURCES } from "~/utils/constants";
import { UsageLimitService } from "./billing/enterprise/usage-limit.service";
import { createLicensePurchaseService } from "./billing/enterprise/license-purchase.service";
import {
  AppBillingErrorReporter,
  AppUsageLimitEmailAdapter,
} from "./billing/enterprise/billing-runtime.adapter";
import { EESubscriptionService } from "./billing/enterprise/subscription.service";
import { EEWebhookService, type WebhookService } from "./billing/enterprise/webhook.service";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { PrismaDataRetentionAdapter } from "@langwatch/data-retention-server";
import { AppEventingRetentionAdapter } from "~/runtime/app/features/eventing-retention.adapter";
import { PostgresShareAdapter } from "@langwatch/share-server";
import { buildAutomationDispatchPorts } from "~/runtime/app/features/automation-dispatch.wiring";
import {
  AutomationPersistCapService,
  PostgresAutomationGraphDeliveryAdapter,
} from "@langwatch/automation-server";
import { createAutomationGraphPorts } from "~/runtime/app/features/automation-graph-ports";
import {
  createAutomationTestFirePort,
  createAutomationTestRuntime,
} from "@langwatch/automation-server/testing";
import { ExperimentEventingAdapter } from "@langwatch/experiment-server";
import {
  LangyAnalyticsEventStorageAdapter,
  NullLangyAnalyticsEventSinkAdapter,
} from "@langwatch/langy-server";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  SimulationRunMetricsStoreAdapter,
  SimulationRunStateStoreAdapter,
} from "@langwatch/scenario-server";
import { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import { ExportService } from "../export/export.service";
import { InviteService } from "../invites/invite.service";
import { resolveOrganizationId } from "../organizations/resolveOrganizationId";
import { OrganizationRepository } from "../repositories/organization.repository";
import { getLicenseHandler } from "~/runtime/app/licensing";
import { sendLicenseEmail } from "~/server/mailer/licenseEmail";
import { TraceEditOverlayService } from "../traces/edit-overlay/traceEditOverlay.service";
import { EventUsageService } from "../traces/event-usage.service";
import { TraceService } from "../traces/trace.service";
import { TraceUsageService } from "../traces/trace-usage.service";
import { AppWorkflowEvaluationAdapter } from "~/runtime/app/features/evaluation";
import { stripUnsupportedLLMParamsFromWorkflow } from "../workflows/stripUnsupportedLLMParams";
import { nlpgoFetch } from "../nlpgo/nlpgoFetch";
import { App, AppShutdownResources, getApp, globalForApp, initializeApp } from "./app";
import { demoProjectId } from "./authz/demo-project";
import { PrismaBillingCheckpointService } from "./billing/billingCheckpoint.service";
import { BroadcastService } from "./broadcast/broadcast.service";
import { TiktokenClient } from "./clients/tokenizer/tiktoken.client";
import { NullTokenizerClient } from "./clients/tokenizer/tokenizer.client";
import { resolveTracePrivacyRuntimeConfig } from "~/runtime/trace-privacy.config";
import {
  type AppConfig,
  createAppConfigFromEnv,
  type ProcessRole,
  roleRunsWorkers,
} from "./config";
import type { AppDependencies, DataRetentionDependencies } from "./dependencies";
import { ManagedProvidersAppAdapter } from "./enterprise/managed-providers.adapter";
import { PrismaEvaluationCostRecorder } from "./evaluations/evaluation-cost.recorder";
import { createDefaultModelEnvResolver } from "./evaluations/evaluation-execution.factories";
import { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import { LogRuntimeAdapter, resolveLogCommandShardCount } from "@langwatch/log-server";
import { MetricRuntimeAdapter, resolveMetricCommandShardCount } from "@langwatch/metric-server";
import {
  NullTraceAnalyticsRepository,
  NullTraceAnalyticsRollupRepository,
  NullTraceSummaryRepository,
  TraceAnalyticsClickHouseRepository,
  TraceAnalyticsRollupClickHouseRepository,
  TraceCanonicalisationService,
  TraceSummaryClickHouseRepository,
} from "@langwatch/trace-server";
import { AppEvaluationAnalyticsReadMetrics } from "~/runtime/app/features/evaluation-analytics-read-metrics.adapter";
import { AppTraceWindowedReadMetricsAdapter } from "~/runtime/app/trace-windowed-read-metrics.adapter";
import { FilterOptionsClickHouseRepository } from "./filters/repositories/filter-options.clickhouse.repository";
import { GithubPrismaInstaller } from "@langwatch/github-server";
import {
  CodingAgentProjectionPersistenceAdapter,
  CodingAgentRuntime,
} from "@langwatch/coding-agent-server";
import {
  AppCodingAgentBillingPolicy,
  AppCodingAgentClickHousePort,
  AppCodingAgentReadMetricsPort,
} from "~/runtime/app/features/coding-agent";
import { AppDatasetRuntime } from "~/runtime/app/features/dataset";
import { AppAutomationTestFireAdapter } from "~/runtime/app/features/automation-test-fire.adapter";
import { AppPromptRuntime } from "~/runtime/app/features/prompt";
import { createLangyConversationTitleGenerator } from "~/runtime/app/features/langy-title-generation.adapter";
import { AppLangyAnalyticsEventClickHouseAdapter } from "~/runtime/app/features/langy-analytics-event.clickhouse.adapter";
import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import { EventExplorerService } from "./ops/event-explorer.service";
import {
  ManagerExplorerService,
  OVERDUE_PENDING_MS,
  OVERDUE_WAKE_MS,
} from "./ops/manager-explorer.service";
import { getOpsMetricsCollector } from "./ops/metrics-collector";
import { NullProcessAuditSink, ProcessAuditRepository } from "./ops/process-audit.repository";
import { ReplayService } from "./ops/replay.service";
import { EventExplorerClickHouseRepository } from "./ops/repositories/event-explorer.clickhouse.repository";
import { NullEventExplorerRepository } from "./ops/repositories/event-explorer.repository";
import { ProcessOpsPrismaRepository } from "./ops/repositories/process-ops.prisma.repository";
import { NullProcessOpsRepository } from "./ops/repositories/process-ops.repository";
import { ReplayRedisRepository } from "./ops/repositories/replay.redis.repository";
import { NullReplayRepository } from "./ops/repositories/replay.repository";
import {
  NoopSchedulerWakeService,
  RedisOpsSnapshotAdapter,
  RedisSchedulerWakeAdapter,
} from "@langwatch/ops-server";
import { AppOpsRuntime } from "~/runtime/app/features/ops";
import { OrganizationService } from "./organizations/organization.service";
import { PrismaOrganizationRepository } from "./organizations/repositories/organization.prisma.repository";
import { NullOrganizationRepository } from "./organizations/repositories/organization.repository";
import { AppPresenceRuntime } from "~/runtime/app/features/presence";
import { loadReportCharts } from "./reports/report-chart.service";
import { dispatchScheduledReport } from "./reports/report-dispatch";
import { toReportTraceRow } from "./reports/trace-report-row";
import {
  NullScheduledJobStore,
  PrismaScheduledJobStore,
} from "./scheduler/scheduled-job.repository";
import { schedulerRegistry } from "./scheduler/scheduler.registry";
import { SchedulerService } from "./scheduler/scheduler.service";
import { createCompositePlanProvider } from "./subscription/composite-plan-provider";
import { PlanProviderService } from "./subscription/plan-provider";
import { createSelfHostedPlanProvider } from "./subscription/self-hosted-plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import {
  AppSuiteRunCommandsPort,
  AppSuiteRunIdPort,
} from "~/runtime/app/features/suite-execution.adapter";
import { startSystemMigrations } from "./system-migrations/boot";
import {
  EventingTopicClusteringScheduleAdapter,
  PostgresTopicAdapter,
  TopicServerInstaller,
} from "@langwatch/topic-server";
import {
  AppTopicClusteringMetricsAdapter,
  createAppTopicClusteringExecutionDependencies,
} from "~/runtime/app/features/topic";
import { maybeExtractSpanMedia } from "./traces/edge-media-extraction";
import { maybeSpool } from "./traces/edge-spool";
import { translateFilterToClickHouse } from "@langwatch/trace-server";
import { LogRecordStorageService } from "./traces/log-record-storage.service";
import { LogRequestCollectionService } from "./traces/log-request-collection.service";
import { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import { LogRecordStorageClickHouseRepository } from "./traces/repositories/log-record-storage.clickhouse.repository";
import {
  NullLogRecordStorageRepository,
  TRACE_LOG_READ_CAP,
} from "./traces/repositories/log-record-storage.repository";
import { SessionGroupsClickHouseRepository } from "./traces/repositories/session-groups.clickhouse.repository";
import { NullSessionGroupsRepository } from "./traces/repositories/session-groups.repository";
import { SpanStorageClickHouseRepository } from "./traces/repositories/span-storage.clickhouse.repository";
import { NullSpanStorageRepository } from "./traces/repositories/span-storage.repository";
import { SessionGroupsService } from "./traces/session-groups.service";
import { createSpanDedupeService } from "./traces/span-dedupe.service";
import { SpanStorageService } from "./traces/span-storage.service";
import { TokenizerService } from "./traces/tokenizer.service";
import { setDiscoverBroadcaster, TraceListService } from "./traces/trace-list.service";
import { TraceSummaryService } from "./traces/trace-summary.service";
import { traced } from "./tracing";
import { UsageService } from "./usage/usage.service";

/** Keeps the connection's lifecycle lines under the name they had before ADR-093. */
const redisLogger = createLogger("langwatch:redis");

class PrismaClickHouseTenantDirectory {
  static create(prisma: typeof globalPrisma): PrismaClickHouseTenantDirectory {
    return new PrismaClickHouseTenantDirectory(prisma);
  }

  private constructor(private readonly prisma: typeof globalPrisma) {}

  async organizationForTenant(tenantId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: tenantId },
      select: { team: { select: { organizationId: true } } },
    });
    if (project?.team.organizationId !== undefined) return project.team.organizationId;

    const organization = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    return organization?.id ?? null;
  }
}

class AppOpsExplainClientResolver extends OpsExplainClientResolver {
  static create({
    opsRuntime,
    clickhouseRuntime,
  }: {
    opsRuntime: OpsClickHouseRuntime;
    clickhouseRuntime: AppClickHouseRuntime;
  }): AppOpsExplainClientResolver {
    return new AppOpsExplainClientResolver(opsRuntime, clickhouseRuntime);
  }

  private constructor(
    private readonly opsRuntime: OpsClickHouseRuntime,
    private readonly clickhouseRuntime: AppClickHouseRuntime,
  ) {
    super();
  }

  resolve(): OpsExplainClientResolution | null {
    const opsClient = this.opsRuntime.resolveClient();
    if (opsClient !== null) return { client: opsClient, usingFallback: false };

    const sharedClient = this.clickhouseRuntime.sharedClient();
    return sharedClient === null ? null : { client: sharedClient, usingFallback: true };
  }
}

class UnavailableOpsExplainClientResolver extends OpsExplainClientResolver {
  static create(): UnavailableOpsExplainClientResolver {
    return new UnavailableOpsExplainClientResolver();
  }

  private constructor() {
    super();
  }

  resolve(): null {
    return null;
  }
}

class AppClickHouseRowsResult {
  static create(result: { json(): Promise<unknown> }): AppClickHouseRowsResult {
    return new AppClickHouseRowsResult(result);
  }

  private constructor(private readonly result: { json(): Promise<unknown> }) {}

  async json<Result = unknown>(): Promise<Result[]> {
    const value = await this.result.json();
    if (!Array.isArray(value)) throw new Error("Expected ClickHouse JSONEachRow result.");
    return value;
  }
}

class AppLogMetricClickHouseClient {
  static create(client: ClickHouseClient): AppLogMetricClickHouseClient {
    return new AppLogMetricClickHouseClient(client);
  }

  private constructor(private readonly client: ClickHouseClient) {}

  insert(params: {
    table: string;
    values: unknown[];
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<unknown> {
    return this.client.insert(params);
  }

  async query(params: {
    query: string;
    query_params?: Record<string, unknown>;
    format?: DataFormat;
    clickhouse_settings?: ClickHouseSettings;
  }): Promise<AppClickHouseRowsResult> {
    return AppClickHouseRowsResult.create(await this.client.query(params));
  }
}

class AppLogMetricClickHouseResolver {
  static create(resolveClient: ClickHouseClientResolver): AppLogMetricClickHouseResolver {
    return new AppLogMetricClickHouseResolver(resolveClient);
  }

  private constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  resolve = async (tenantId: string): Promise<AppLogMetricClickHouseClient> => {
    return AppLogMetricClickHouseClient.create(await this.resolveClient(tenantId));
  };
}

class AppGatewayClickHouseSettings {
  static from(
    input:
      | Record<
          string,
          string | number | boolean | Record<string, string | number | boolean> | undefined
        >
      | undefined,
  ): ClickHouseSettings | undefined {
    if (input === undefined) return undefined;
    const settings: ClickHouseSettings = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || typeof value !== "object") settings[key] = value;
      else {
        const entries = Object.entries(value).map(([nestedKey, nestedValue]) => [
          nestedKey,
          String(nestedValue),
        ]);
        settings[key] = SettingsMap.from(Object.fromEntries(entries));
      }
    }
    return settings;
  }
}

class AppGatewayClickHouseClient {
  static create(client: ClickHouseClient): AppGatewayClickHouseClient {
    return new AppGatewayClickHouseClient(client);
  }

  private constructor(private readonly client: ClickHouseClient) {}

  async query(input: {
    query: string;
    query_params?: Record<string, unknown>;
    format: "JSONEachRow";
    clickhouse_settings?: Record<
      string,
      string | number | boolean | Record<string, string | number | boolean> | undefined
    >;
  }): Promise<AppClickHouseRowsResult> {
    const settings = AppGatewayClickHouseSettings.from(input.clickhouse_settings);
    const result = await this.client.query({
      query: input.query,
      query_params: input.query_params,
      format: input.format,
      ...(settings === undefined ? {} : { clickhouse_settings: settings }),
    });
    return AppClickHouseRowsResult.create(result);
  }

  async insert(input: {
    table: string;
    values: Record<string, unknown>[];
    format?: "JSONEachRow";
    clickhouse_settings?: Record<
      string,
      string | number | boolean | Record<string, string | number | boolean> | undefined
    >;
  }): Promise<void> {
    const settings = AppGatewayClickHouseSettings.from(input.clickhouse_settings);
    await this.client.insert({
      table: input.table,
      values: input.values,
      format: input.format,
      ...(settings === undefined ? {} : { clickhouse_settings: settings }),
    });
  }
}

class AppGatewayClickHouseResolver {
  static create(resolveClient: ClickHouseClientResolver): AppGatewayClickHouseResolver {
    return new AppGatewayClickHouseResolver(resolveClient);
  }

  private constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  resolve = async (tenantId: string): Promise<AppGatewayClickHouseClient> => {
    return AppGatewayClickHouseClient.create(await this.resolveClient(tenantId));
  };
}

export function initializeWebApp(): App {
  return initializeDefaultApp({ processRole: "web" });
}

export function initializeWorkerApp(): App {
  return initializeDefaultApp({ processRole: "worker" });
}

/**
 * Dev-only single-process mode: the web server also hosts the worker stack
 * in-process (opt-in via WORKERS_IN_PROCESS=1). Boots the App with the "all"
 * role so process outbox/wake consumers and schedulers wire up exactly as
 * they do on a dedicated worker. Prod never calls this — it runs
 * web and worker as separate deployments.
 */
export function initializeInProcessApp(): App {
  return initializeDefaultApp({ processRole: "all" });
}

export interface DefaultAppCompositionOptions {
  processRole?: ProcessRole;
  prismaConnection?: PrismaConnection;
}

export function initializeDefaultApp(options?: DefaultAppCompositionOptions): App {
  if (options?.prismaConnection) {
    adoptPrismaConnection(options.prismaConnection);
  }
  if (globalForApp.__langwatch_app) return globalForApp.__langwatch_app;

  const config = createAppConfigFromEnv({ processRole: options?.processRole });
  if (!options?.prismaConnection) {
    configurePrismaConnection(
      createProcessPrismaConnection({
        databaseUrl: config.databaseUrl,
        nodeEnv: config.nodeEnv,
      }),
    );
  }
  const prismaConnection = getPrismaConnection();
  const prisma = globalPrisma;
  AppAuditLogRuntime.install({ prisma });
  const clickhouseRuntime = AppClickHouseRuntime.create({
    sharedUrl: config.clickhouseUrl,
    privateRoutes: config.clickhousePrivateRoutes,
    poolSizing: config.clickhousePoolSizing,
    directory: PrismaClickHouseTenantDirectory.create(prisma),
    buildTime: config.buildTime,
  });
  const opsClickHouseRuntime = OpsClickHouseRuntime.create({
    url: config.clickhouseOpsUrl,
    buildTime: config.buildTime,
  });
  configureClickHouseRuntime(clickhouseRuntime);
  configureProcessOutboundProxy(config.outboundProxy);
  const aws = configureAwsClientConfiguration(config.outboundProxy);
  const clickhouseEnabled = !config.buildTime && isClickHouseEnabled();
  // Resolver: given a tenantId (projectId), returns the right ClickHouse client
  const resolveClickHouseClient: ClickHouseClientResolver = async (
    tenantId: string,
  ): Promise<ClickHouseClient> => {
    const client = await getClickHouseClientForTenant(tenantId);
    if (!client) throw new Error(`ClickHouse not available for tenant ${tenantId}`);
    return client;
  };
  const logMetricClickHouseResolver =
    AppLogMetricClickHouseResolver.create(resolveClickHouseClient);
  const gatewayClickHouseResolver = AppGatewayClickHouseResolver.create(resolveClickHouseClient);

  const processStore = PrismaProcessStore.create({ database: prismaConnection.client });

  // ADR-093: the composition root owns the App's Redis connection, and nothing
  // holds one at module scope. Two entry points outside a serving process build
  // their own and close it themselves — `replayPreset` (which needs a
  // standalone client, since its multi-key work CROSSSLOT-rejects on a cluster)
  // and the `migrateObjectStorage` task, which boots no App at all. Both go
  // through the client package; neither is a second live connection in a
  // process this one is serving.
  const redisRuntime = AppRedisRuntime.create({
    config: {
      url: config.redisUrl,
      clusterEndpoints: config.redisClusterEndpoints,
      dbIndex: config.redisDbIndex,
      skip: config.skipRedis,
    },
    logger: redisLogger,
  });
  const redis = redisRuntime.connection;
  const featureFlags = PostgresFeatureFlagAdapter.create({
    database: prisma,
    cache: RedisFeatureFlagCacheAdapter.create(redis),
    config: config.featureFlags,
    now: Date.now,
  });
  const traceCanonicalisation = TraceCanonicalisationService.create();
  const nlpLambda = createProcessNlpLambdaRuntime({
    config: config.nlpLambda,
    redis,
    aws,
  });

  const authzFeature = AuthzFeature.create({
    database: prisma,
    redis: redis as never,
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    cacheEnabled: () => {
      const raw = process.env.AUTHZ_EPOCH_CACHE;
      return raw === "1" || raw === "true";
    },
    demoProjectId,
  });

  const managedProviders = ManagedProvidersAppAdapter.create({
    prisma,
    environment: process.env,
  }).service;
  const roles = AppRoleRuntime.create({
    database: prisma,
    grants: authzFeature.grants,
    permissions: authzFeature.permissions,
  }).build();

  const canonicalOrganizations = AppOrganizationRuntime.create({
    database: prisma,
    authz: authzFeature.permissions,
    grants: authzFeature.grants,
  }).build();
  const licenseEnforcement = createLicenseEnforcementService(prisma);
  const broadcast = new BroadcastService(redis);
  const storedObjectsService = createProcessStoredObjectsService();
  const userAvatarInfrastructure = AppUserAvatarStorageInfrastructureAdapter.create();
  const userAvatarStorage =
    AppUserAvatarStoredObjectStorageAdapter.create(userAvatarInfrastructure);
  const userAvatarStoredObjects = createProcessUserAvatarStoredObjectService({
    database: prisma,
    storage: userAvatarStorage,
  });
  const userAvatarObjects = AppUserAvatarReadCompatibilityAdapter.create({
    canonical: userAvatarStoredObjects,
    historical: storedObjectsService,
  });
  const evaluationInputsOffloadConfig = config.evaluationInputsOffload;
  const projects = traced(
    AppProjectRuntime.create({
      database: prisma,
      generateProjectId: nanoid,
      generateApiKey,
      organizations: canonicalOrganizations,
      keyMap: LwqlKeyMapService.create(new LwqlKeyMapClickHouseRepository(resolveClickHouseClient)),
      storedObjects: {
        deleteOwnedBy: (input) => storedObjectsService.deleteOwnedBy(input),
      },
      diagnostics: {
        error: (context, message) => createLogger("langwatch:project").error(context, message),
        capture: (error, context) => captureException(error, { extra: context }),
      },
    }).build(),
    "ProjectService",
  );
  const dataPrivacy = PrismaDataPrivacyAdapter.create({
    prisma,
    projects,
    organizations: canonicalOrganizations,
  });
  const tracePrivacy = AppTracePrivacyRuntime.create({
    config: config.tracePrivacy,
    dataPrivacy,
    featureFlags,
    tokenizer: config.disableTokenization
      ? new NullTokenizerClient()
      : TiktokenClient.create(config.tracePrivacy.tokenizer),
  });
  const logRuntime = clickhouseEnabled
    ? LogRuntimeAdapter.create({
        resolveClient: logMetricClickHouseResolver.resolve,
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        defaultReadLimit: TRACE_LOG_READ_CAP,
        logCommandShardCount: resolveLogCommandShardCount(process.env.LOG_PROCESSING_SHARDS),
        redaction: tracePrivacy.redaction,
      })
    : LogRuntimeAdapter.createUnavailable({
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        logCommandShardCount: resolveLogCommandShardCount(process.env.LOG_PROCESSING_SHARDS),
        redaction: tracePrivacy.redaction,
      });
  const metricRuntime = clickhouseEnabled
    ? MetricRuntimeAdapter.create({
        resolveClient: logMetricClickHouseResolver.resolve,
        resolveOrganizationClient: logMetricClickHouseResolver.resolve,
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        metricCommandShardCount: resolveMetricCommandShardCount(
          process.env.METRIC_PROCESSING_SHARDS,
        ),
        redaction: tracePrivacy.redaction,
      })
    : MetricRuntimeAdapter.createUnavailable({
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        metricCommandShardCount: resolveMetricCommandShardCount(
          process.env.METRIC_PROCESSING_SHARDS,
        ),
        redaction: tracePrivacy.redaction,
      });
  const logs = logRuntime.getService();
  const metrics = metricRuntime.getService();
  const tokenizer = new TokenizerService(tracePrivacy.tokenizer);
  const modelProviders = AppModelProviderRuntime.create({
    database: prisma,
    organizations: canonicalOrganizations,
    projects,
    managedProviders,
    systemProviderEnvironment: process.env,
    isSaas: env.IS_SAAS === "true",
    permissions: authzFeature.permissions,
  }).build();

  const topic = TopicServerInstaller.create({
    database: prisma,
    processStore,
    redis,
    execution: createAppTopicClusteringExecutionDependencies({
      resolveClickHouseClient,
      modelProviders,
      langevalsEndpoint: config.langevals.endpoint ?? null,
    }),
    metrics: new AppTopicClusteringMetricsAdapter(),
  });
  const prompts = AppPromptRuntime.create({
    database: prisma,
    modelProvider: modelProviders,
  }).build();
  const apiKeyPepper = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!apiKeyPepper) {
    throw new Error("API key pepper not configured: set CREDENTIALS_SECRET or NEXTAUTH_SECRET");
  }
  const apiKeys = traced(
    AppApiKeyRuntime.create({
      database: prisma,
      pepper: apiKeyPepper,
      authz: authzFeature.permissions,
      grants: authzFeature.grants,
      organizations: canonicalOrganizations,
      projects,
      deriveBindingId: AuthzFeature.deriveGrantId,
      diagnostics: AppApiKeyDiagnostics.create(createLogger("langwatch:api-key")),
    }).build(),
    "ApiKeyService",
  );
  const presence = AppPresenceRuntime.create({
    redis,
    broadcast,
    projects,
  });
  const spanDedup = createSpanDedupeService(redis);

  // ADR-022: construct blob/IO deps before the summary + span services so
  // both v2 read paths (header full:true, spansFull / spanDetail) can resolve
  // offloaded eventref pointers.
  // #4888: the same factory backs the customer-facing full=true read path; the
  // composition root passes its own ClickHouse decision/resolver so the
  // eval-path deps stay byte-identical to the pre-#4888 inline wiring.
  const { blobStore, ioExtractionService } = buildTraceBlobResolutionDeps(traceCanonicalisation, {
    clickhouseEnabled,
    resolveClickHouseClient,
  });
  // Shared between SpanStorageService and TraceSummaryService's full read.
  const spanStorageRepository = clickhouseEnabled
    ? new SpanStorageClickHouseRepository(resolveClickHouseClient)
    : new NullSpanStorageRepository();

  // Resolves the per-tenant retention cascade; shared by the DSPy CH repo
  // (which stamps dspy_steps as a traces-category table), the read floors that
  // bound `evaluation_runs`, and the data-retention services wired further
  // below. Constructed here rather than beside those services because the
  // evaluation-run repository below needs it and is built first — without it
  // that read floor silently falls back to the platform default, which is the
  // whole point of making it tenant-aware.
  const dataRetentionService = PrismaDataRetentionAdapter.create({
    database: prisma,
    projects,
    organizations: canonicalOrganizations,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    redis,
    cacheTtlMs: 60_000,
    resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : null,
  });
  const eventingRetention = AppEventingRetentionAdapter.create(dataRetentionService);
  const share = traced(
    PostgresShareAdapter.create({
      database: prisma,
      dataRetention: dataRetentionService,
      projects,
      permissions: authzFeature.permissions,
      grants: authzFeature.grants,
      redis,
    }),
    "ShareService",
  );
  const organizations = traced(
    new OrganizationService(
      new PrismaOrganizationRepository(prisma, authzFeature.grants),
      prompts,
      canonicalOrganizations,
      licenseEnforcement,
      share,
    ),
    "OrganizationService",
  );

  const traceSummary = traced(
    new TraceSummaryService(
      clickhouseEnabled
        ? TraceSummaryClickHouseRepository.create({
            resolveClient: resolveClickHouseClient,
            defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
            windowedReadMetrics: AppTraceWindowedReadMetricsAdapter.create(),
          })
        : new NullTraceSummaryRepository(),
      { spanStorageRepository, blobStore, ioExtractionService },
    ),
    "TraceSummaryService",
  );
  const topics = traced(topic.service, "TopicService");
  // Wire the discover-cache → SSE bridge. Module-level setter keeps
  // the TraceListService constructor lean (the null/test preset below
  // doesn't need a broadcaster — refreshes that never get an SSE push
  // still hydrate the cache successfully).
  setDiscoverBroadcaster((tenantId) => {
    // Broadcast.event payload is a string by contract — sender + SSE
    // bridge both deserialise it on the client. Keep it tiny: timestamp
    // is enough for the client to confirm freshness; the actual payload
    // ships through the discover query they re-fire on receipt.
    const payload = JSON.stringify({
      event: "discover_updated",
      tenantId,
      timestamp: Date.now(),
    });
    void broadcast.broadcastToTenantRateLimited(tenantId, payload, "discover_updated");
  });
  const spanStorage = traced(
    new SpanStorageService(spanStorageRepository, {
      blobStore,
      ioExtractionService,
    }),
    "SpanStorageService",
  );
  const logRecordStorage = traced(
    new LogRecordStorageService({
      repository: clickhouseEnabled
        ? new LogRecordStorageClickHouseRepository(resolveClickHouseClient)
        : new NullLogRecordStorageRepository(),
      canonical: logs,
    }),
    "LogRecordStorageService",
  );
  const simulationQueueRun = new Deferred<AppCommands["simulations"]["queueRun"]>(
    "simulationQueueRun",
  );
  const simulationStartRun = new Deferred<AppCommands["simulations"]["startRun"]>(
    "simulationStartRun",
  );
  const simulationMessageSnapshot = new Deferred<AppCommands["simulations"]["messageSnapshot"]>(
    "simulationMessageSnapshot",
  );
  const simulationTextMessageStart = new Deferred<AppCommands["simulations"]["textMessageStart"]>(
    "simulationTextMessageStart",
  );
  const simulationTextMessageEnd = new Deferred<AppCommands["simulations"]["textMessageEnd"]>(
    "simulationTextMessageEnd",
  );
  const simulationFinishRun = new Deferred<AppCommands["simulations"]["finishRun"]>(
    "simulationFinishRun",
  );
  const simulationCancelRun = new Deferred<AppCommands["simulations"]["cancelRun"]>(
    "simulationCancelRun",
  );
  const simulationDeleteRun = new Deferred<AppCommands["simulations"]["deleteRun"]>(
    "simulationDeleteRun",
  );
  const simulations = traced(
    AppSimulationRuntime.create({
      clickhouseEnabled,
      resolveClient: resolveClickHouseClient,
      commands: {
        queueRun: simulationQueueRun.fn,
        startRun: simulationStartRun.fn,
        messageSnapshot: simulationMessageSnapshot.fn,
        textMessageStart: simulationTextMessageStart.fn,
        textMessageEnd: simulationTextMessageEnd.fn,
        finishRun: simulationFinishRun.fn,
        cancelRun: simulationCancelRun.fn,
        deleteRun: simulationDeleteRun.fn,
      },
    }).build(),
    "SimulationService",
  );
  const scenarioClock = AppScenarioClock.create();
  const scenarioSecretCipher = new AppScenarioSecretCipher();
  const scenarios = traced(
    AppScenarioRuntime.create({
      database: prisma,
      simulations,
      ids: AppScenarioId.create(() => generate(KSUID_RESOURCES.SCENARIO).toString()),
      folderIds: AppScenarioFolderId.create(() => `suite_${nanoid()}`),
      clock: scenarioClock,
      secretCipher: scenarioSecretCipher,
    }).build(),
    "ScenarioService",
  );
  const datasetRuntime = AppDatasetRuntime.create({ database: prisma });
  const dataset = traced(datasetRuntime.build(), "DatasetService");
  const annotations = traced(
    PostgresAnnotationAdapter.create({
      database: prisma,
      projects,
      organizations: canonicalOrganizations,
    }).build(),
    "AnnotationService",
  );
  const workflowNlpRuntime = AppWorkflowNlpRuntimePort.create(nlpLambda);
  const workflows = traced(
    AppWorkflowRuntime.create({
      database: prisma,
      datasets: dataset,
      modelProviders,
      nlpRuntime: workflowNlpRuntime,
      projectEnvironment: AppWorkflowProjectEnvironmentPort.create({
        database: prisma,
        encryption: AppWorkflowEnvironmentEncryption.create(),
      }),
      llmParameters: AppWorkflowLlmParametersPort.create({
        modelProviders,
      }),
    }).build(),
    "WorkflowService",
  );
  const agents = AgentsFeature.create({
    prisma,
    session: null,
    workflows,
  });
  const evaluators = traced(
    EvaluatorFeature.create({ prisma, workflows, nlpRuntime: workflowNlpRuntime }),
    "EvaluatorService",
  );
  const experiments = traced(
    AppExperimentRuntime.create({
      database: prisma,
      resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : async () => null,
      tupleParam: (values) => new TupleParam(values),
      runHistoryTelemetry: AppExperimentRunHistoryObservability.create(),
      dspyRetention: AppExperimentDspyRetentionPort.create(dataRetentionService),
      execution: AppExperimentEventingAdapter.create(() => commands.experimentRuns).build(),
      slugify,
      newId: () => nanoid(8),
      references: { prompts, agents, evaluators, workflows, dataset },
      updates: AppExperimentWorkbenchUpdatesAdapter.create(broadcast),
    }).build(),
    "ExperimentService",
  );
  const traceService = TraceService.create({
    prisma,
    blobResolutionDeps: {
      blobStore,
      ioExtractionService,
    },
    retentionResolver: dataRetentionService,
    annotationService: annotations,
    traceCanonicalisation,
  });
  const exportService = ExportService.create({ traceService });

  const evaluationExecution = traced(
    EvaluationExecutionService.create({
      traceService,
      modelProviders,
      managedProviders,
      modelEnvResolver: createDefaultModelEnvResolver(modelProviders, managedProviders),
      langevalsClient: AppLangevalsRuntime.create(config.langevals),
      workflows,
      evaluators,
      workflowExecutor: AppWorkflowEvaluationAdapter.create(workflows),
    }),
    "EvaluationExecutionService",
  );
  const evaluationRuntime = AppEvaluationRuntime.create({
    resolveClickHouse: resolveClickHouseClient,
    retentionFloor: createRetentionFloorService(dataRetentionService),
    execution: AppEvaluationExecutionPort.create((input) =>
      evaluationExecution.executeForTrace({
        ...input,
        mappings: input.mappings === null ? null : mappingStateSchema.parse(input.mappings),
      }),
    ),
    workflows,
    featureFlags,
    storedObjects: storedObjectsService,
    inputsOffloadConfig: evaluationInputsOffloadConfig,
  });
  const evaluationService = traced(evaluationRuntime.build(), "EvaluationService");
  traceService.connectEvaluations(evaluationService);
  const traceList = traced(
    new TraceListService(
      clickhouseEnabled
        ? AppTraceRuntime.createListRepository(resolveClickHouseClient)
        : AppTraceRuntime.createNullListRepository(),
      evaluationService,
      topics,
    ),
    "TraceListService",
  );

  // The Analytics read API, built once here (unconditional on
  // `clickhouseEnabled`, since the resolver itself already throws at query
  // time when ClickHouse isn't configured) and handed out as
  // `app.analytics` instead of each of its callers
  // constructing — and each resolving a ClickHouse client — its own.
  const analyticsService = AnalyticsAdapter.create({
    resolveClient: resolveClickHouseClient,
    clickhouseEnabled,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    evaluationReadMetrics: AppEvaluationAnalyticsReadMetrics.create(),
    tripwire: LoggingAnalyticsTripwire.create({
      isEnabled: async (projectId) =>
        featureFlags.isEnabled("release_event_sourced_analytics_read_tripwire", {
          kind: "project",
          projectId,
        }),
    }),
  });
  const langWatchQL = createLangWatchQLService();
  const dashboardService = PostgresDashboardAdapter.create({
    database: prisma,
    ids: { generate: () => nanoid() },
    // The compatibility transports validate with caller protections before
    // this service is reached. The process policy is the same Analytics
    // validator for internal callers, using the API-key/full-project view.
    savedWorkbenchChartPolicy: {
      validate: async ({ projectId, definition }) => {
        validateSavedWorkbenchChartDefinition({
          projectId,
          protections: await getProtectionsForProject(prisma, { projectId }),
          definition,
          lwql: langWatchQL,
        });
      },
    },
  }).build();
  // Suite execution commands are registered after the Suite adapter is built.
  // Deferred dispatchers let the adapter's one run-state repository be shared
  // with Eventing during pipeline registration without a second service.
  const suiteStartRun = new Deferred<AppCommands["suiteRuns"]["startSuiteRun"]>("suiteStartRun");
  const suiteQueueRun = new Deferred<AppCommands["simulations"]["queueRun"]>("suiteQueueRun");
  const suiteAdapter = PostgresSuiteAdapter.create({
    database: prisma,
    agents,
    prompts,
    scenarios,
    resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : null,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    execution: SuiteExecutionService.create({
      commands: AppSuiteRunCommandsPort.create({
        startSuiteRun: suiteStartRun.fn,
        queueSimulationRun: suiteQueueRun.fn,
      }),
      ids: new AppSuiteRunIdPort(),
      scenarios,
    }),
    generateId: () => `suite_${nanoid()}`,
  });
  const suiteRuntime = AppSuiteRuntime.create(suiteAdapter);
  const suiteEventing = suiteRuntime.eventing();
  const suites = traced(suiteRuntime.build(), "SuiteService");

  const planResolver = (organizationId: string) =>
    getApp().planProvider.getActivePlan({ organizationId });
  const traceUsageService = TraceUsageService.create(prisma);
  const eventUsageService = new EventUsageService();
  const orgRepo = new OrganizationRepository(prisma);
  const usage = new UsageService(
    organizations,
    traceUsageService,
    eventUsageService,
    planResolver,
    orgRepo,
  );

  const billingCatalogue = BillingPriceCatalogue.create(
    getStripeEnvironmentFromNodeEnv(process.env.NODE_ENV),
  );
  const billingPersistence = PostgresBillingAdapter.create(prisma).build();
  const billingSubscriptions = billingPersistence.subscriptions;
  const saasPlanProvider = SaaSPlanProviderService.create({
    subscriptions: billingSubscriptions,
    isSaas: config.isSaas ?? false,
    adminEmails: env.ADMIN_EMAILS,
  });

  const planProvider = config.isSaas
    ? PlanProviderService.create(
        createCompositePlanProvider({
          saasPlanProvider: {
            getActivePlan: ({ organizationId, user }) =>
              saasPlanProvider.getActivePlan(organizationId, user),
          },
          licensePlanProvider: {
            getActivePlan: ({ organizationId }) =>
              getLicenseHandler().getActivePlan(organizationId),
          },
          adminEmails: env.ADMIN_EMAILS,
        }),
      )
    : PlanProviderService.create(
        createSelfHostedPlanProvider({
          licensePlanProvider: {
            // Self-hosted asks a different question than the composite provider
            // above: with no subscription underneath, a license past its end
            // date has to keep metering the seats it sold instead of stepping
            // aside. See LicenseHandler.getSelfHostedPlan.
            getActivePlan: ({ organizationId }) =>
              getLicenseHandler().getSelfHostedPlan(organizationId),
          },
        }),
      );

  let subscription: SubscriptionService | undefined;
  let billingCustomer: CustomerService | undefined;
  let usageReportingService: StripeUsageReportingService | undefined;
  let webhookService: WebhookService | undefined;
  let stripeClient: StripeClientAdapter["client"] | undefined;
  if (config.isSaas) {
    stripeClient = StripeClientAdapter.create({
      secretKey: env.STRIPE_SECRET_KEY,
    }).client;
    usageReportingService = StripeUsageReportingService.create({
      stripe: stripeClient,
      meterId: billingCatalogue.meters.BILLABLE_EVENTS,
    });
    const stripeErrors = StripeErrorAdapter.create();
    const customerCurrency = StripeCustomerCurrencyService.create(stripeErrors);
    const seatEventService = SeatEventSubscriptionService.create({
      stripe: stripeClient,
      database: prisma,
      prices: billingCatalogue.prices,
      customerCurrency,
    });
    const itemCalculator = SubscriptionItemCalculatorService.create(billingCatalogue.prices);
    billingCustomer = CustomerService.create({
      stripe: stripeClient,
      organizations,
    });
    subscription = EESubscriptionService.create({
      stripe: stripeClient,
      db: prisma,
      itemCalculator,
      seatEventFns: seatEventService,
    });
    const licensePurchaseService = createLicensePurchaseService({
      sendLicenseEmail,
      notifyLicensePurchase: (input) => getApp().notifications.sendSlackLicensePurchase(input),
    });
    webhookService = EEWebhookService.create({
      db: prisma,
      stripe: stripeClient,
      itemCalculator,
      // Pass planProvider explicitly — InviteService.create defaults to
      // getApp().planProvider, but we're still inside initializeDefaultApp
      // so the App singleton isn't available yet.
      inviteApprover: InviteService.create(prisma, {
        planProvider,
        authzGrants: authzFeature.grants,
        roleService: roles,
      }),
      licensePurchaseHandler: licensePurchaseService,
      licensePaymentLinkId: env.STRIPE_LICENSE_PAYMENT_LINK_ID,
      licensePrivateKey: env.LANGWATCH_LICENSE_PRIVATE_KEY,
      getPostHog: () => getPostHogInstance(),
    });
  }

  const monitors = traced(
    PostgresMonitorAdapter.create({
      database: prisma,
      evaluators,
      generateId: () => generate(KSUID_RESOURCES.MONITOR).toString(),
    }),
    "MonitorService",
  );
  const automationClock = new AppAutomationClock();
  const automationDelivery = PostgresAutomationGraphDeliveryAdapter.create({
    database: prisma,
    clock: automationClock,
  });
  const automationEmailCaps = createAppAutomationEmailCaps(redis);
  const automationPersistCaps = AutomationPersistCapService.create({
    projects,
    planProvider,
    config: {
      free: env.TRIGGER_PERSIST_DAILY_CAP_FREE,
      paid: env.TRIGGER_PERSIST_DAILY_CAP_PAID,
      enterprise: env.TRIGGER_PERSIST_DAILY_CAP_ENTERPRISE,
    },
    redis: redis ?? null,
  });
  const graphPorts = createAutomationGraphPorts({
    redis: redis ?? null,
    clock: automationClock,
    emailCaps: automationEmailCaps,
    delivery: automationDelivery,
    projects,
    authz: authzFeature.permissions,
    analytics: analyticsService,
    resolveClickHouseClient,
    baseHost: config.baseHost,
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
  });
  const automation = AppAutomationRuntime.create({
    database: prisma,
    redis,
    graph: graphPorts,
    clock: automationClock,
    testFire: AppAutomationTestFireAdapter.create(),
    persistCaps: automationPersistCaps,
  }).build();
  const billingErrorReporter = AppBillingErrorReporter.create();
  const nurturing = config.customerIoApiKey
    ? NurturingService.create({
        config: {
          customerIoApiKey: config.customerIoApiKey,
          customerIoRegion: config.customerIoRegion,
        },
        errorReporter: billingErrorReporter,
      })
    : undefined;

  const dataRetention: DataRetentionDependencies = dataRetentionService;

  const langyAdapter = PostgresLangyAdapter.create({ database: prisma });
  const langyPersistence = langyAdapter.eventing();
  const langyWorkerMetrics = AppLangyWorkerMetricsPort.create();
  const langyWorker = config.langyWorker
    ? createLangyWorkerPort({ ...config.langyWorker, metrics: langyWorkerMetrics })
    : UnavailableLangyWorkerAdapter.create(langyWorkerMetrics);
  const langyHandoffStore = LangyTurnHandoffStore.create({ redis: redis! });
  const langyTokenBuffer = redis ? LangyTokenBuffer.create({ redis }) : null;
  const langyTitleGenerator = createLangyConversationTitleGenerator({
    messages: langyPersistence.trustedMessages,
  });
  const langySessionKeys = langyAdapter.createSessionKeys({
    apiKeys,
    authz: authzFeature.permissions,
    metrics: AppLangySessionKeyMetricsAdapter.create(),
  });

  const codingAgentProjections = CodingAgentProjectionPersistenceAdapter.create({
    clickHouse: clickhouseEnabled
      ? AppCodingAgentClickHousePort.create(resolveClickHouseClient)
      : null,
    retention: {
      defaultTraceRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    },
    readMetrics: AppCodingAgentReadMetricsPort.create(),
  });

  // The address lock is shared: the guards claim through it and the fold
  // releases through it, so the two must be the same instance (ADR-116 §6).
  const identityReservations = new PrismaIdentityReservationRepository(prisma);

  // Construct repositories at the composition root — ClickHouse-or-Memory decisions live here.
  const repositories: PipelineRepositories = {
    simulationRunState: clickhouseEnabled
      ? SimulationRunStateStoreAdapter.create({
          type: "clickhouse",
          resolveClient: resolveClickHouseClient,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        })
      : SimulationRunStateStoreAdapter.create({ type: "memory" }),
    simulationRunMetricsStore: clickhouseEnabled
      ? SimulationRunMetricsStoreAdapter.create({
          type: "clickhouse",
          resolveClient: resolveClickHouseClient,
        })
      : SimulationRunMetricsStoreAdapter.create({ type: "null" }),
    experimentRunState: ExperimentEventingAdapter.createStateRepository({
      resolveClient: resolveClickHouseClient,
      clickhouseEnabled,
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    }),
    experimentIdLookup: ExperimentEventingAdapter.createIdLookup({
      resolveClient: resolveClickHouseClient,
      clickhouseEnabled,
    }),
    traceSummaryFold: clickhouseEnabled
      ? TraceSummaryClickHouseRepository.create({
          resolveClient: resolveClickHouseClient,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          windowedReadMetrics: AppTraceWindowedReadMetricsAdapter.create(),
        })
      : traceSummary.repository,
    codingAgentProjections,
    traceAnalyticsRollup: clickhouseEnabled
      ? TraceAnalyticsRollupClickHouseRepository.create({
          resolveClient: resolveClickHouseClient,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        })
      : new NullTraceAnalyticsRollupRepository(),
    traceAnalytics: clickhouseEnabled
      ? TraceAnalyticsClickHouseRepository.create({
          resolveClient: resolveClickHouseClient,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          windowedReadMetrics: AppTraceWindowedReadMetricsAdapter.create(),
        })
      : new NullTraceAnalyticsRepository(),
    experimentRunItemStorage: ExperimentEventingAdapter.createItemStore(
      resolveClickHouseClient,
      PLATFORM_DEFAULT_RETENTION_DAYS,
    ),
    langyConversationState: langyPersistence.langyConversationState,
    langyConversationTurnState: langyPersistence.langyConversationTurnState,
    langyMessageStorage: langyPersistence.langyMessageStorage,
    langyAnalyticsEventStorage: LangyAnalyticsEventStorageAdapter.create({
      sink: clickhouseEnabled
        ? new AppLangyAnalyticsEventClickHouseAdapter(resolveClickHouseClient)
        : NullLangyAnalyticsEventSinkAdapter.create(),
      defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    }),
    processStore,
    langyTurnAdmission: langyPersistence.langyTurnAdmission,
  };

  const traceSummaryStore = createAppTraceSummaryStore({
    repository: repositories.traceSummaryFold,
    redis,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    foldCacheTtlSeconds: config.eventingFoldCacheTtlSeconds,
  });

  // The spend-command pipeline projects gateway_spend; it shares the
  // ClickHouse gate because the spend record has no PG fallback (a mutable
  // counter is the failure mode this table exists to replace).
  const gatewaySpend = clickhouseEnabled
    ? {
        port: GatewaySpendEventsClickHouseAdapter.create(gatewayClickHouseResolver.resolve),
      }
    : undefined;

  // The webhook delivery process manager scans the spend table, so it
  // shares the same ClickHouse gate. Registration is global; the per-org
  // enterprise flag is enforced inside the scan (and at the REST surface).
  const webhookEndpointService = createEnterpriseWebhookEndpointService({
    prisma,
  });
  const webhookHealth = WebhookHealthService.create({
    endpoints: webhookEndpointService,
    processStore,
  });
  installEnterpriseWebhookAccess(planProvider);
  const webhookDeliveryDeps: WebhookDeliveryProcessDeps | undefined = clickhouseEnabled
    ? {
        processStore: repositories.processStore,
        endpoints: webhookEndpointService,
        pruneExpiredIdempotencyReceipts: (now: Date) =>
          pruneExpiredIdempotencyReceipts({ prisma, now }),
        dispatch: ({ destination, ...input }) => webhookDestinationFor(destination).send(input),
        getPlan: (organizationId: string) => planProvider.getActivePlan({ organizationId }),
      }
    : undefined;
  const webhookDelivery = webhookDeliveryDeps
    ? WebhookDeliveryService.create(webhookDeliveryDeps)
    : undefined;

  // The gateway's ClickHouse-backed repositories, built once and handed out
  // on the App. Every surface - tRPC routers, the REST apps, the CLI auth
  // route - takes these instead of minting its own, which is how REST came to
  // serve stale PG spend for the same budgets the UI showed live (#6248), and
  // how the CLI route ended up with a second copy of the same constructor.
  const gatewayBudgetRepository = clickhouseEnabled
    ? GatewayBudgetLedgerAdapter.create(gatewayClickHouseResolver.resolve)
    : undefined;
  const gatewayBudgetDecisions = PrismaGatewayAdapter.create({
    database: prisma,
    projects,
    budgetSpend: gatewayBudgetRepository,
  }).build();
  const gatewayChanges = createGatewayChangeEventsPort(prisma);
  const gatewayVirtualKeySpend = clickhouseEnabled
    ? GatewayVirtualKeySpendAdapter.create(gatewayClickHouseResolver.resolve)
    : undefined;
  const gatewayWebhookEventsRepository = clickhouseEnabled
    ? WebhookEventsClickHouseRepository.create(resolveClickHouseClient)
    : undefined;
  const webhookEvents = gatewayWebhookEventsRepository
    ? WebhookEventsService.create({ prisma, repository: gatewayWebhookEventsRepository })
    : undefined;

  // Gateway budget debits ride the spend pipeline and share its ClickHouse
  // gate: the ledger is the only store spend accrues in.
  const gatewayDebits =
    clickhouseEnabled && gatewayBudgetRepository
      ? AppGatewayGovernancePort.create(
          prisma,
          gatewayBudgetRepository,
          gatewayBudgetDecisions,
          gatewayChanges,
          createBudgetChangeEventDedupeService(redis),
        )
      : undefined;

  // Governance's KPI rollup. One instance for the whole App: the subscriber
  // sync writes through it, the spend-spike anomaly evaluator reads through
  // it — the same repository reference the process manager below takes.
  const governanceKpisRepository = clickhouseEnabled
    ? new AppGovernanceKpisAdapter(resolveClickHouseClient)
    : undefined;
  const governanceKpisSync = governanceKpisRepository ? { governanceKpisRepository } : undefined;

  // Governance's OCSF SIEM-export sink. One instance for the whole App: the
  // subscriber sync writes through it, the puller worker and the workspace-view
  // audit trail write through it, and the SIEM export procedure reads
  // through it — the same repository reference the process manager below takes.
  const governanceOcsfEventsRepository = clickhouseEnabled
    ? new AppGovernanceOcsfEventsAdapter(resolveClickHouseClient)
    : undefined;
  const governanceOcsfEventsSync = governanceOcsfEventsRepository
    ? { governanceOcsfEventsRepository }
    : undefined;

  // Governance-domain reads over the shared `trace_summaries` table (the
  // persona-detection activity probe, the quarantine-fill breakdown).
  const governanceTraceActivityRepository = clickhouseEnabled
    ? new AppGovernanceTraceActivityAdapter(resolveClickHouseClient)
    : undefined;

  // The /me dashboard's spend/token/model rollups, over trace_summaries
  // and the gateway ledger's PRINCIPAL rows.
  const personalUsageRepository = clickhouseEnabled
    ? new AppPersonalUsageReadAdapter(resolveClickHouseClient)
    : undefined;
  const governanceActivity = AppIngestionSourceActivityAdapter.create({
    database: prisma,
    resolveClient: async (organizationId) =>
      clickhouseEnabled ? getClickHouseClientForOrganization(organizationId) : null,
  }).clickhouse();

  // Governance is composed once after its event-sourcing command ports have
  // registered. Request transports then receive that one capability through
  // `ctx.app`; the worker uses the same project service directly.
  const gatewayVirtualKeyCrypto = createProcessVirtualKeyCrypto(config);
  const governanceVirtualKeys = VirtualKeyService.create(prisma, projects, gatewayVirtualKeyCrypto);
  const governanceIngestionPullHost = AppGovernanceIngestionPullHost.create(featureFlags, aws);
  const governanceOptions = {
    organizations,
    projects,
    apiKeys,
    setupActivity: governanceTraceActivityRepository,
    ocsfEvents: governanceOcsfEventsRepository,
    traceActivity: governanceTraceActivityRepository,
    personalUsage: personalUsageRepository,
    gatewayBaseUrl: resolveGatewayBaseUrl({
      LW_GATEWAY_PUBLIC_URL: env.LW_GATEWAY_PUBLIC_URL,
      LW_GATEWAY_BASE_URL: env.LW_GATEWAY_BASE_URL,
      IS_SAAS: config.isSaas,
    }),
    virtualKeys: governanceVirtualKeys,
    budgetOverview: BudgetOverviewService.create({
      database: prisma,
      budgetRepository: gatewayBudgetRepository,
      budgetDecisions: gatewayBudgetDecisions,
      organizations,
      featureFlags,
      personalUsage: personalUsageRepository,
      personalVirtualKeys: governanceVirtualKeys,
    }),
    providers: AppGovernanceModelProviderCatalog.create(),
    contacts: AppGovernanceOrganizationContacts.create(prisma),
    redis,
    ottl: {
      baseUrl: env.LW_GATEWAY_INTERNAL_URL ?? env.LW_GATEWAY_BASE_URL,
      secret: env.LW_GATEWAY_INTERNAL_SECRET,
    },
  };
  const secrets = AppSecretRuntime.create({ database: prisma });
  const ingestionPullWorker = AppIngestionPullWorkerAdapter.create({
    sources: PostgresIngestionPullSourceAdapter.create(prisma),
    host: governanceIngestionPullHost,
    projects,
    events: governanceOcsfEventsRepository,
  }).build();

  // The /governance activity-monitor read side (spend rollups, per-source
  // events and health). Org-scoped aggregates, but the queries key on the
  // hidden governance Project, so it takes the standard per-tenant resolver —
  // getClickHouseClientForTenant maps a project id to its org's route.
  const activityMonitorRepository = clickhouseEnabled
    ? new ActivityMonitorClickHouseRepository(resolveClickHouseClient)
    : undefined;

  // Billing-month usage rollups (billable_events + trace_summaries),
  // read by the billing pipeline and the usage-limit services.
  const billableEventsRepository = clickhouseEnabled
    ? ClickHouseBillingAdapter.create({
        resolveClient: resolveClickHouseClient,
        resolveOrganizationClient: getClickHouseClientForOrganization,
      }).build()
    : null;
  const billingQueries = BillableEventsQueryService.create(billableEventsRepository);

  const eventingPersistenceRetention = createEventingRetentionConfiguration({
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
  });
  const eventStore = clickhouseEnabled
    ? EventingClickHouseEventStore.create({
        repository: EventingClickHouseEventRepository.create({
          resolveClient: resolveClickHouseClient,
          retention: eventingPersistenceRetention,
        }),
        retention: eventingPersistenceRetention,
        retentionPolicyResolver: eventingRetention,
      })
    : undefined;
  const queueFactory = redis
    ? createEventingGroupQueueFactory({
        consumersEnabled: roleRunsWorkers(config.processRole),
        dependencies: {
          redis,
          policy: config.groupQueue,
          objectStoreFor: (projectId) => createStorageRegistry({ projectId }),
          resolveStorageDestination: resolveProjectStorageDestination,
        },
      })
    : undefined;

  const es = new EventSourcing({
    eventStore,
    queueFactory,
    enabled: true,
    consumersEnabled: roleRunsWorkers(config.processRole),
    executionTarget: config.processRole === "all" ? undefined : config.processRole,
    replayMarkerChecker: redis ? new RedisReplayMarkerChecker(redis) : undefined,
    retentionPolicyResolver: eventingRetention,
    warnWhenProjectionsRunInline: config.nodeEnv === "production",
    configureGlobalProjections: config.isSaas
      ? (registry) => {
          registry.registerMapProjection(orgBillableEventsMeterProjection);
          registry.registerMapSubscriber(
            "orgBillableEventsMeter",
            createBillingMeterDispatchSubscriber({
              getDispatch: () => {
                const pipeline = es.getPipeline(BILLING_REPORTING_PIPELINE_NAME);
                return (data) => pipeline.commands.reportUsageForMonth.send(data);
              },
            }),
          );
        }
      : undefined,
    processStore: repositories.processStore,
  });

  const traceTree = clickhouseEnabled
    ? AppTraceRuntime.create({
        database: prisma,
        records: traceService,
        spans: spanStorage,
        blobStore,
        fullIo: ioExtractionService,
        resolveClient: resolveClickHouseClient,
        modelProviders,
        queryFieldValues: AppTraceQueryFieldValuesAdapter.create(traceList),
        traceSummaryStore,
      }).build()
    : AppTraceRuntime.createNull(modelProviders);

  // ADR-052: automation dispatch ports for the process-manager runtime the
  // registry composes (triggerSettlement + graphAlertSweep). Built on every
  // role — registration is passive shape; the outbox/wake worker loops
  // start only where roleRunsWorkers() is true.
  const automationPorts = buildAutomationDispatchPorts({
    prisma,
    automation,
    emailCaps: automationEmailCaps,
    projects,
    evaluations: evaluationService,
    traces: {
      canonicalisation: traceCanonicalisation,
      tree: traceTree,
    },
    dataset,
    annotations,
    baseHost: config.baseHost,
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
  });

  // ADR-044 Phase 1: the generic calendar scheduler. No cron infra. A
  // worker-only in-process loop that sleeps until the soonest due
  // `ScheduledJob`, atomically claims each due row (a conditional nextRunAt
  // update — the DB-level exactly-once guarantee), and fires it into a handler
  // registered on `schedulerRegistry`. There is no leader-lock: because the
  // claim guarantees exactly-once, every worker runs the loop and races the
  // claim, sharing firing load across the fleet. Postgres is the sole
  // correctness/locking layer; `redis` is passed only for the BEST-EFFORT
  // cross-pod wake (a job created on one pod fires everywhere now instead of
  // within one poll backstop) — a missing/flaky Redis just falls back to the
  // poll, never affecting correctness. Kept dormant this phase — no consumers
  // register yet (the report handler lands in a later phase), so the loop runs
  // and log-and-skips any orphan targetType.
  const scheduler = roleRunsWorkers(config.processRole)
    ? new SchedulerService({
        repo: new PrismaScheduledJobStore(prisma),
        registry: schedulerRegistry,
        processRole: config.processRole,
        logger: createLogger("langwatch:app-layer:scheduler"),
        redis,
      })
    : undefined;
  scheduler?.start();

  // ADR-044 Phase 3c: register the report handler so a due report ScheduledJob
  // renders + dispatches on schedule (worker-only, same notify pipeline as
  // alerts). The scheduler registry is a process singleton.
  if (roleRunsWorkers(config.processRole)) {
    schedulerRegistry.register({
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
      handler: (fire) =>
        dispatchScheduledReport({
          deps: {
            loadTrigger: ({ projectId, triggerId }) =>
              automation.tryGetById({ triggerId, projectId }),
            loadProject: (projectId) => prisma.project.findUnique({ where: { id: projectId } }),
            sendEmail: sendRenderedTriggerEmail,
            sendSlack: sendRenderedSlackMessage,
            sendSlackBot: postSlackChatMessage,
            filterSuppressedRecipients: ({ projectId, triggerId, emails }) =>
              automation.filterSuppressed({
                projectId,
                triggerId,
                emails,
              }),
            // The top-N traces matching the report's Subject query over its
            // window, via the shared TraceListService. The ADR-043 filter DSL
            // compiles the author's query straight into the bare-column
            // `filterWhere` getList takes, so a "top matching traces" report
            // finally matches on what the author asked for. (The older
            // filters-OBJECT builder could not: it emits `ts.`-aliased
            // conditions for a JOIN context, invalid here.)
            listReportTraces: async ({ projectId, projectSlug, query, from, to, limit }) => {
              const page = await traceList.getList({
                tenantId: projectId,
                timeRange: { from, to },
                sort: { columnId: "time", direction: "desc" },
                page: 1,
                pageSize: limit,
                visibilityCutoffMs: null,
                filterWhere:
                  translateFilterToClickHouse(query, projectId, { from, to }) ?? undefined,
              });
              const projectUrl = `${config.baseHost}/${projectSlug}`;
              return page.items.map((item) => toReportTraceRow({ item, projectUrl }));
            },
            // A report's fire is a completed EVENT, not an open incident, so
            // `resolvedAt` is stamped at write time. The list's "currently
            // firing" read looks for `customGraphId != null AND resolvedAt IS
            // NULL`, so a report row can never masquerade as a live alert.
            recordFire: async ({ projectId, triggerId, firedAt }) => {
              await automation.recordFire({
                projectId,
                triggerId,
                traceId: null,
                customGraphId: null,
                createdAt: firedAt,
                resolvedAt: firedAt,
              });
            },
            loadReportCharts: ({ projectId, source, from, to }) =>
              loadReportCharts({
                deps: {
                  // Both reads are scoped to builder charts: a scheduled
                  // report renders each one through `getTimeseries`, which
                  // needs the series a builder payload carries and a saved
                  // workbench chart's definition does not have.
                  loadCustomGraph: ({ projectId, customGraphId }) =>
                    prisma.customGraph.findFirst({
                      where: {
                        id: customGraphId,
                        projectId,
                        kind: BUILDER_CHART_KIND,
                      },
                    }),
                  loadDashboardGraphs: ({ projectId, dashboardId }) =>
                    prisma.customGraph.findMany({
                      where: {
                        dashboardId,
                        projectId,
                        kind: BUILDER_CHART_KIND,
                      },
                      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
                    }),
                  getTimeseries: (input) => analyticsService.getTimeseries(input),
                },
                source,
                projectId,
                from,
                to,
              }),
            baseHost: config.baseHost,
          },
          fire,
        }),
    });

    // ADR-044 durable self-heal: the report upsert route writes the Trigger row
    // and its ScheduledJob in two non-atomic steps, so a crash between them can
    // leave an active report with no schedule. Repair any such gaps at boot
    // (create-if-missing, race-safe on every worker). Fire-and-forget so boot is
    // never blocked; a failure is logged, not fatal (the next boot retries).
    const reconcileLogger = createLogger("langwatch:app-layer:scheduler");
    void automation
      .reconcileReportSchedules()
      .then(({ repaired }) => {
        if (repaired > 0) {
          reconcileLogger.info(
            { repaired },
            "Reconciled report schedules missing a ScheduledJob at boot",
          );
        }
      })
      .catch((error: unknown) => {
        reconcileLogger.error(
          { error: error instanceof Error ? error.message : String(error) },
          "Report-schedule reconciliation failed at boot (will retry next boot)",
        );
      });
  }

  const githubService = GithubPrismaInstaller.create({
    database: prisma,
    config: {
      appId: env.GITHUB_LANGY_APP_ID ?? "",
      privateKey: env.GITHUB_LANGY_PRIVATE_KEY ?? "",
      appSlug: env.GITHUB_LANGY_APP_SLUG ?? "",
      webhookSecret: env.GITHUB_LANGY_WEBHOOK_SECRET ?? "",
      signingKey: env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET ?? "",
    },
    redis: redis ?? null,
    hostConfig: { host: env.GITHUB_LANGY_HOST },
    organization: organizations,
    project: projects,
  });

  const scenarioExecutionPrefetcher = ScenarioExecutionPrefetcherService.create({
    scenarios,
    suites,
    prompts,
    agents,
    workflows,
    projects,
    modelProviders,
    secrets,
    traces: traceTree,
    secretCipher: scenarioSecretCipher,
    config: config.scenarioExecution,
  });
  const scenarioExecutionPool = roleRunsWorkers(config.processRole)
    ? ScenarioExecutionPoolService.create({ concurrency: SCENARIO_WORKER.CONCURRENCY })
    : null;
  const scenarioCancellations = redis
    ? RedisCancellationPublisherAdapter.create(redis)
    : UnavailableCancellationPublisherAdapter.create();
  const scenarioExecution = ScenarioExecutionService.create({
    pool: scenarioExecutionPool ?? UnavailableScenarioExecutionPoolService.create(),
    cancellations: scenarioCancellations,
    prefetcher: scenarioExecutionPrefetcher,
    failures: ScenarioFailureHandlerService.create({ agents, simulations }),
  });
  const scenarioTabs = ScenarioTabRegistryService.create({
    store: redis ? RedisScenarioTabStoreAdapter.create(redis) : null,
    clock: scenarioClock,
  });
  const traceProjectionStorage = AppTraceProjectionStorageAdapter.create({
    spans: spanStorageRepository,
    analytics: repositories.traceAnalytics,
    analyticsRollup: repositories.traceAnalyticsRollup,
  });

  const registry = new PipelineRegistry({
    eventSourcing: es,
    traceCanonicalisation,
    logProcessing: logRuntime,
    metricProcessing: metricRuntime,
    authz: {
      pipeline: authzFeature.pipeline,
      connect: (authzCommands) => authzFeature.connect(authzCommands as never),
    },
    repositories,
    traceSummaryStore,
    foldCacheTtlSeconds: config.eventingFoldCacheTtlSeconds,
    suiteRunState: suiteEventing.suiteRunState,
    redis: redis!,
    broadcast,
    simulations,
    scenarioExecutions: scenarioExecution,
    codingAgent: {
      github: githubService,
    },
    github: githubService,
    langy: {
      buffer: langyTokenBuffer,
      handoffStore: langyHandoffStore,
      worker: langyWorker,
      titleGenerator: langyTitleGenerator,
      sessionKeys: langySessionKeys,
    },
    automations: {
      ports: automationPorts,
    },
    datasetNormalization: {
      process: (payload) => datasetRuntime.processNormalization(payload),
      connect: (sender) => datasetRuntime.connectNormalization(sender),
    },
    topicClustering: { installer: topic },
    enterprisePipelines: AppGovernanceEventingRuntime.create(
      AppIngestionPullExecutionRuntime.create(
        ingestionPullWorker,
        gatewayBudgetRepository,
        AppGovernanceIngestionPullMetrics.create(),
      ),
      AppIngestionPullLifecycleRuntime.create(
        prisma,
        projects,
        AppGovernanceIngestionPullSchedule.create(),
        roleRunsWorkers(config.processRole),
      ),
    ),
    projects,
    monitors,
    modelProviders,
    featureFlags,
    tracePrivacy,
    evaluationControls: evaluationRuntime.buildExecutionControls(),
    automation,
    prisma,
    organizations,
    traces: { summary: traceSummary, spans: spanStorage, tree: traceTree },
    traceProjectionStorage,
    evaluations: evaluationService,
    analytics: analyticsService,
    storedObjects: storedObjectsService,
    evaluationInputsOffloadConfig,
    costRecorder: PrismaEvaluationCostRecorder.create(prisma),
    billingCheckpoints: new PrismaBillingCheckpointService(prisma),
    usageReportingService,
    gatewaySpend,
    webhookDelivery: webhookDeliveryDeps,
    gatewayDebits,
    // ADR-022: Inject BlobStore into the pipeline registry so RecordSpanCommand
    // can reconstitute oversized commands (fetch from transient S3 spool) and
    // best-effort delete the spool after event_log INSERT succeeds.
    blobStore,
    governanceKpisSync,
    governanceOcsfEventsSync,
  });
  const commands = registry.registerAll();
  simulationQueueRun.resolve(commands.simulations.queueRun);
  simulationStartRun.resolve(commands.simulations.startRun);
  simulationMessageSnapshot.resolve(commands.simulations.messageSnapshot);
  simulationTextMessageStart.resolve(commands.simulations.textMessageStart);
  simulationTextMessageEnd.resolve(commands.simulations.textMessageEnd);
  simulationFinishRun.resolve(commands.simulations.finishRun);
  simulationCancelRun.resolve(commands.simulations.cancelRun);
  simulationDeleteRun.resolve(commands.simulations.deleteRun);
  suiteStartRun.resolve(commands.suiteRuns.startSuiteRun);
  suiteQueueRun.resolve(commands.simulations.queueRun);
  const ingestionSources = AppIngestionSourceAdapter.create({
    plans: planProvider,
    lifecycle: registry.getGovernanceLifecycle(),
    secretPepper: env.LW_VIRTUAL_KEY_PEPPER ?? "",
    encryption: governanceIngestionPullHost.encryption,
  });
  const governance = AppGovernanceRuntime.create(prisma, {
    ...governanceOptions,
    eventing: AppGovernanceEventingAdapter.governancePort(
      commands.ingestionPull,
      commands.pulledUsage,
    ),
    activityClickhouse: governanceActivity,
    ingestionSourceEntitlements: ingestionSources.entitlements(),
    ingestionSourceLifecycle: ingestionSources.lifecycle(),
    ingestionEncryption: ingestionSources.encryption(),
    ingestionSecretPepper: ingestionSources.secretPepper(),
    ingestionDiagnostics: ingestionSources.diagnostics(),
  });
  const users = AppUserRuntimeAdapter.create({
    database: prisma,
    redis,
    organizations,
    governance,
    storedObjects: userAvatarStoredObjects,
  });
  const scim = PostgresScimAdapter.create({
    database: prisma,
    writer: authzFeature.grants,
    users,
    governance,
    entitlements: planProvider,
  }).build();
  // The package-owned migration starts only after the pipeline has connected
  // its command dispatcher. The app process exposes metadata but runs no
  // automatic pass; worker-capable roles run one level-triggered pass.
  const systemMigrations = roleRunsWorkers(config.processRole)
    ? startSystemMigrations({
        redis,
        additionalMigrations: [authzFeature.migration],
      })
    : undefined;

  if (roleRunsWorkers(config.processRole)) {
    // One-time background seeds on worker boot (ADR-051): topic-model
    // history onto the event stream, and daily-wake schedules for
    // pre-cutover projects. The migration owns its own wiring, coordination,
    // and error handling — a failure is logged and the next boot retries.
    topic.startBootSeeds();
  }

  // The organization's GitHub connection: the install/webhook lifecycle, and
  // the token mints Langy (write) and pull-request linkage (read) ask for. The
  // App is optional per instance; when the private key is unset the service
  // reports `configured=false` and every read short-circuits to "GitHub
  // unavailable" without touching GitHub. The App private key is the only
  // credential and it lives here in the control plane, never near a worker.
  const langyCredentialComposition = createAppLangyCredentialComposition({
    sessionKeys: langySessionKeys,
    prisma,
    virtualKeys: governanceVirtualKeys,
    github: githubService,
    workerCallbackUrl:
      env.LANGY_WORKER_CALLBACK_URL ?? env.LANGWATCH_ENDPOINT ?? env.LANGWATCH_API_URL,
    workerGatewayBaseUrl:
      env.LANGY_WORKER_GATEWAY_URL ?? env.LW_GATEWAY_PUBLIC_URL ?? env.LW_GATEWAY_BASE_URL,
    mirrorProjectId: env.LANGY_MIRROR_PROJECT_ID,
  });

  const simulationExports = ScenarioRunExportService.create(simulations);
  const langyNavigateFallback = AppLangyNavigateFallbackAdapter.create({
    simulations,
    prompts,
    dataset,
    workflows,
    experiments,
    monitors,
    evaluators,
    agents,
    projects,
  });

  // Langy turn-start orchestration (ADR-046): the pipeline the
  // Hono route used to inline, now an app-layer service with injected ports. The
  // worker port + turn stores are null when their infra is absent (no agent env /
  // no Redis); the service raises LangyAgentUnavailableError in that case, exactly
  // as the route 503'd.
  const langyService = langyAdapter.build({
    commands: commands.langy,
    events: es.getEventStore<LangyConversationProcessingEvent>() ?? null,
    relay: redis
      ? {
          redis,
          baseHost: config.baseHost,
          resolveCapabilityProgress: resolveLangyCapabilityProgress,
          resolveResourceUrl: (input) => langyNavigateFallback.resolve(input),
          logger: createLogger("langwatch:langy:relay"),
        }
      : undefined,
    credentials: langyCredentialComposition,
    turns: {
      // ADR-050 versioned prompts. Only consulted when LANGY_PROMPT_PROJECT_ID
      // names the project holding the rows; unset (the default) skips the
      // registry entirely and the in-repo text is used verbatim.
      prompts,
      promptProjectId: env.LANGY_PROMPT_PROJECT_ID?.trim(),
      models: {
        resolve: ({ projectId }) =>
          getVercelAIModel({
            projectId,
            featureKey: LANGY_CHAT_FEATURE_KEY,
            modelProviders,
            managedProviders,
          }),
      },
      worker: config.langyWorker ? langyWorker : null,
      tokenBuffer: redis ? langyTokenBuffer : null,
      permits: {
        reserve: reserveLangyGithubPrPermit,
        release: releaseLangyGithubPrPermit,
        check: getLangyGithubPrUsage,
      },
      harness: { resolve: resolveLangyHarness },
      perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
      sessionKeys: langySessionKeys,
      context: { render: renderLangyTurnContext },
      metrics: {
        count: ({ outcome }) => getLangyTurnsCounter(outcome).inc(),
      },
      accessStore: redis ? LangyTurnAccessStore.create({ redis }) : null,
      handoffStore: redis ? langyHandoffStore : null,
    },
    feedbackPromptRedis: redis,
  });

  const codingAgents = traced(
    CodingAgentRuntime.create({
      projections: codingAgentProjections,
      github: githubService,
      projects,
      billing: AppCodingAgentBillingPolicy.create(governance),
    }).service,
    "CodingAgentService",
  );

  const traceCollection = traced(
    AppTraceRuntime.createIngestion({
      codingAgents,
      codingAgentSpanFilterEnabled: config.codingAgentSpanFilterEnabled,
      dedup: spanDedup,
      recordSpan: commands.traces.recordSpan,
      // ADR-022: Edge size-check + transient S3 spool, on by default and
      // switchable off per project. projectId === tenantId (routes/otel.ts
      // passes project.id). processCommandData runs PER SPAN (not once per OTLP
      // request/batch); the flag is resolved per span against the operator
      // store, falling back to the registry default rather than PostHog, and
      // the 5s-cached store keeps that per-span read cheap.
      //
      // FAIL-OPEN: any error from the flag store (Postgres/network blip) or
      // from maybeSpool (S3 outage, BlobStore.putSpool throws) is caught here.
      // We log at warn level and return the original commandData unchanged so
      // that ingestion is never blocked by the spool path. The span then takes
      // the inline route, where capOversizedAttributes bounds each attribute
      // value at 256 KB. ADR-022.
      payloads: AppTraceRuntime.createIngressPayloadPort(async (data) => {
        // Media extraction runs FIRST: externalizing inline media parts to
        // the content-addressed stored-objects store usually brings the
        // payload back under COMMAND_INLINE_THRESHOLD, so the transient
        // whole-payload spool below rarely needs to fire. Internally
        // fail-open (marker-gated, flag-gated, privacy-interlocked) — on any
        // error it returns `data` unchanged and the spool proceeds as today.
        data = await maybeExtractSpanMedia({
          data,
          deps: {
            featureFlags,
            service: storedObjectsService,
          },
          logger: createLogger("langwatch:traces:edge-media-extraction"),
        });

        // Track which stage failed so the fail-open counter carries a useful
        // reason label (flag_store vs spool/S3) for alerting (GtVrL).
        let stage: "flag_store" | "spool" = "flag_store";
        try {
          const enabled = await featureFlags.isEnabled("release_trace_blob_offload", {
            kind: "project",
            projectId: data.tenantId,
          });
          if (!enabled) return data;
          stage = "spool";
          return await maybeSpool({
            data,
            blobStore,
            logger: createLogger("langwatch:traces:edge-spool"),
          });
        } catch (err) {
          getEdgeSpoolFailOpenCounter(stage).inc();
          createLogger("langwatch:traces:edge-spool-fail-open").warn(
            {
              projectId: data.tenantId,
              traceId: data.span.traceId,
              spanId: data.span.spanId,
              reason: stage,
              error: err instanceof Error ? err.message : String(err),
            },
            "Edge spool unavailable, ingesting this oversized span inline (fail-open). Attribute values above 256 KB will be truncated on this span; configure S3-compatible object storage to keep them intact.",
          );
          return data;
        }
      }),
    }),
    "TraceRequestCollectionService",
  );

  const logCollection = traced(
    new LogRequestCollectionService({
      traceCanonicalisation,
      logs,
      recordLogRecords: commands.logs.recordLogRecord.sendBatch!,
      recordLogContributions: commands.traces.recordLogContribution.sendBatch!,
    }),
    "LogRequestCollectionService",
  );

  const metricCollection = traced(
    new MetricRequestCollectionService({
      metrics,
      recordDataPoints: commands.metrics.recordDataPoint.sendBatch!,
      recordMetricCorrelations: commands.traces.recordMetricCorrelation.sendBatch!,
    }),
    "MetricRequestCollectionService",
  );

  const sessionGroups = traced(
    new SessionGroupsService({
      repository: clickhouseEnabled
        ? new SessionGroupsClickHouseRepository(resolveClickHouseClient)
        : new NullSessionGroupsRepository(),
      codingAgentSessions: codingAgents,
      resolveOrganizationId,
    }),
    "SessionGroupsService",
  );
  const traces = {
    canonicalisation: traceCanonicalisation,
    read: traceService,
    export: exportService,
    tree: traceTree,
    summary: traceSummary,
    list: traceList,
    sessionGroups,
    spans: spanStorage,
    logRecords: logRecordStorage,
    collection: traceCollection,
    logCollection,
    metricCollection,
    editOverlay: TraceEditOverlayService.create(prisma),
  };

  // Subscribers must settle before their transports disappear. The App owns
  // this sequence so every process role follows the same connection order.
  const shutdownResources = new AppShutdownResources();
  shutdownResources.register("subscriber", "nlp-lambda-aws-clients", () => nlpLambda.close());
  shutdownResources.register("subscriber", "dataset-s3-clients", () => datasetRuntime.close());
  shutdownResources.register("subscriber", "trace-privacy", () => tracePrivacy.close());
  shutdownResources.register("clickhouse", "langwatchql", () => langWatchQL.close());
  shutdownResources.register("clickhouse", "ops-explain", () => opsClickHouseRuntime.close());
  shutdownResources.register("clickhouse", "clickhouse", () =>
    shutdownComposedClickHouseRuntime(clickhouseRuntime),
  );
  // BEFORE the Redis closeable, deliberately: stopping the writer hands the
  // snapshot lease back, and a released lease is the difference between the
  // fleet electing a new writer immediately and going without one for the
  // remainder of the lease window — the rolling-deploy case. Once Redis is
  // disconnected the release can no longer be issued at all.
  shutdownResources.register("subscriber", "ops-snapshot", async () => {
    await ops.metricsCollector?.stop();
    ops.snapshots?.stop();
  });
  if (redis) {
    shutdownResources.register("redis", "redis", () => redisRuntime.close());
  }
  shutdownResources.register("subscriber", "broadcast", async () => {
    await broadcast.close();
  });
  if (scheduler) {
    shutdownResources.register("subscriber", "scheduler", () => scheduler.stop());
  }
  if (systemMigrations) {
    // Aborts the pass between tenants; a truncated pass is harmless because
    // every migration is idempotent and the next boot resumes the sweep.
    shutdownResources.register("subscriber", "system-migrations", () => systemMigrations.stop());
  }
  shutdownResources.register("subscriber", "sqs-webhook-clients", async () => {
    resetSqsClientCache();
    await closeAwsClientConfiguration();
  });
  shutdownResources.register("database", "prisma", closePrismaConnection);

  const notifications = NotificationService.create({
    config: {
      baseHost: config.baseHost,
      slackPlanLimitChannel: config.slackPlanLimitChannel,
      slackSignupsChannel: config.slackSignupsChannel,
      slackSubscriptionsChannel: config.slackSubscriptionsChannel,
      hubspotPortalId: config.hubspotPortalId,
      hubspotReachedLimitFormId: config.hubspotReachedLimitFormId,
      hubspotFormId: config.hubspotFormId,
    },
    errorReporter: billingErrorReporter,
    usageLimitEmail: AppUsageLimitEmailAdapter.create(),
  });
  const notificationRecords = billingPersistence.notifications;
  const usageLimits = UsageLimitService.create({
    notificationRecords,
    organizationService: organizations,
    usageService: usage,
    notificationService: notifications,
    planProvider,
    isSaas: config.isSaas,
    baseHost: config.baseHost,
  });

  const opsService = AppOpsRuntime.create({
    database: prisma,
    adminEmails: process.env.ADMIN_EMAILS ?? "",
    redis,
    users,
    scheduler: {
      repository: new PrismaScheduledJobStore(prisma),
      wake: redis ? RedisSchedulerWakeAdapter.create(redis) : NoopSchedulerWakeService.create(),
      projects,
    },
  }).build();

  const replayRepo = redis ? new ReplayRedisRepository(redis) : new NullReplayRepository();
  const snapshots = redis ? RedisOpsSnapshotAdapter.create({ redis }) : null;
  snapshots?.start().catch((error) => {
    logger.error({ error }, "Failed to start ops snapshot service");
  });
  const sharedCh = _getSharedClickHouseClient();
  const eventExplorerRepo = sharedCh
    ? new EventExplorerClickHouseRepository(sharedCh)
    : new NullEventExplorerRepository();

  const ops = Object.assign(opsService, {
    eventExplorer: new EventExplorerService(eventExplorerRepo),
    managerExplorer: (() => {
      const fleet = new ProcessOpsPrismaRepository(prisma);
      // The pm_* gauges read the same counts the fleet table shows, on
      // scrape, so alerting watches what the operator would see.
      bindProcessFleetMetricsSource(() =>
        fleet.countByProcessName({
          now: Date.now(),
          overdueWakeMs: OVERDUE_WAKE_MS,
          overduePendingMs: OVERDUE_PENDING_MS,
        }),
      );
      return new ManagerExplorerService({
        store: repositories.processStore,
        fleet,
        audit: new ProcessAuditRepository(prisma),
      });
    })(),
    replay: new ReplayService(replayRepo, eventingRetention),
    metricsCollector: redis ? getOpsMetricsCollector({ redis, ops: opsService, snapshots }) : null,
    snapshots,
  });

  const app = initializeApp({
    config,
    nlpLambda,
    agents,
    dataset,
    annotations,
    workflows,
    evaluators,
    monitors,
    broadcast,
    presence,
    traces,
    evaluations: evaluationService,
    featureFlags,
    experiments,
    scenarios,
    scenarioTabs,
    scenarioExecution,
    scenarioExecutionPool,
    suites,
    automation,
    analytics: analyticsService,
    langWatchQL,
    dashboard: dashboardService,
    simulations,
    simulationExports,
    topics,
    gateway: {
      virtualKeys: governanceVirtualKeys,
      budgetDecisions: gatewayBudgetDecisions,
      budgets: gatewayBudgetRepository,
      changes: gatewayChanges,
      virtualKeySpend: gatewayVirtualKeySpend,
      spendEvents: gatewaySpend ? GatewaySpendEventsService.create(gatewaySpend.port) : undefined,
      webhookEvents,
      webhookEndpoints: webhookEndpointService,
      webhookHealth,
      webhookDelivery,
    },
    filters: {
      options: new FilterService(
        clickhouseEnabled ? new FilterOptionsClickHouseRepository(resolveClickHouseClient) : null,
      ),
    },
    clickhouse: {
      enabled: clickhouseEnabled,
      resolveClient: resolveClickHouseClient,
      resolveOrganizationClient: getClickHouseClientForOrganization,
      allInstances: getAllClickHouseInstances,
    },
    redis,
    billing: {
      events: new BillableEventsMeterClickHouseRepository(getClickHouseClientForOrganization),
    },
    governance,
    billableEvents: billableEventsRepository ?? undefined,
    billingQueries,
    codingAgents,
    github: githubService,
    storedObjects: storedObjectsService,
    userAvatarObjects,
    storedObjectOwners: StoredObjectOwnerLookupRuntime.create({
      instanceDirectory: AppStoredObjectOwnerInstanceDirectory.create(),
      telemetry: AppStoredObjectOwnerLookupTracingAdapter.create(),
    }).resolver,
    opsExplain: {
      service: new OpsExplainService(
        new OpsExplainClickHouseRepository(
          AppOpsExplainClientResolver.create({
            opsRuntime: opsClickHouseRuntime,
            clickhouseRuntime,
          }),
        ),
      ),
    },
    // traced() gives every service call a `ClassName.method` span, same as
    // the rest of the app bag. Per-method, not per-frame: the streaming hot
    // paths (token buffer, relay frames) stay span-free by design.
    langy: traced(langyService, "LangyService"),
    organizations,
    projects,
    users,
    roles,
    secrets,
    permissions: authzFeature.permissions,
    authzGrants: authzFeature.grants,
    tokenizer,
    usage,
    planProvider,
    subscription,
    billingCustomer,
    webhookService,
    stripeClient,
    notifications,
    apiKeys,
    managedProviders,
    scim,
    modelProviders,
    prompts,
    nurturing,
    usageLimits,
    dataRetention,
    share,
    commands,
    ops,
    _eventSourcing: es,
    _authzMigration: authzFeature.migration,
    _shutdownResources: shutdownResources,
  });
  return app;
}

/** Tests — noop commands, null-backed services. */
export function createTestApp(
  overrides?: Partial<AppDependencies> & {
    suiteCommands?: {
      startSuiteRun: AppCommands["suiteRuns"]["startSuiteRun"];
      queueRun: AppCommands["simulations"]["queueRun"];
    };
  },
): App {
  const processConfig = createAppConfigFromEnv();
  const testPrismaConfiguration = {
    databaseUrl: overrides?.config?.databaseUrl ?? processConfig.databaseUrl,
    nodeEnv: overrides?.config?.nodeEnv ?? processConfig.nodeEnv,
  };
  if (!hasPrismaConnection()) {
    configurePrismaConnection(createProcessPrismaConnection(testPrismaConfiguration));
  }
  const testPrismaConnection = getPrismaConnection();
  const testPrisma = globalPrisma;
  AppAuditLogRuntime.install({ prisma: testPrisma });
  const noop = async () => {
    /* noop */
  };
  const testSimulationCommands = {
    queueRun: noop,
    startRun: noop,
    messageSnapshot: noop,
    textMessageStart: noop,
    textMessageEnd: noop,
    finishRun: noop,
    cancelRun: noop,
    deleteRun: noop,
    computeRunMetrics: noop,
  } as AppCommands["simulations"];
  const testAuthz = AuthzFeature.create({
    database: testPrisma,
    redis: null,
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    cacheEnabled: () => false,
    demoProjectId: () => undefined,
  });
  const storedObjectsService = createProcessStoredObjectsService();
  const userAvatarInfrastructure = AppUserAvatarStorageInfrastructureAdapter.create();
  const userAvatarStorage =
    AppUserAvatarStoredObjectStorageAdapter.create(userAvatarInfrastructure);
  const userAvatarStoredObjects = createProcessUserAvatarStoredObjectService({
    database: testPrisma,
    storage: userAvatarStorage,
  });
  const userAvatarObjects = AppUserAvatarReadCompatibilityAdapter.create({
    canonical: userAvatarStoredObjects,
    historical: storedObjectsService,
  });
  const managedProviders = ManagedProvidersAppAdapter.create({
    prisma: testPrisma,
    environment: {},
  }).service;
  const testRoles = AppRoleRuntime.create({
    database: testPrisma,
    grants: testAuthz.grants,
    permissions: testAuthz.permissions,
  }).build();
  testAuthz.connect({
    attachGrant: { send: noop },
    changeGrantRole: { send: noop },
    revokeGrant: { send: noop },
    defineRole: { send: noop },
    changeRolePermissions: { send: noop },
    deleteRole: { send: noop },
  });
  // Clear the module-global discover broadcaster so a test app built
  // after `initializeDefaultApp` doesn't inherit the production
  // broadcaster's closure (which captured the production
  // BroadcastService and would fire SSE pushes out of tests). The
  // null repository's no-op refresh path can still reach the
  // broadcaster, so leaving the prod callback wired would leak
  // cross-app callbacks. Tests that want their own broadcaster can
  // re-register one after `createTestApp` returns.
  setDiscoverBroadcaster(null);
  const config: AppConfig = {
    nodeEnv: testPrismaConfiguration.nodeEnv,
    buildTime: false,
    databaseUrl: testPrismaConfiguration.databaseUrl,
    clickhousePoolSizing: {},
    clickhousePrivateRoutes: [],
    groupQueue: {
      compression: "gzip",
      payloadCodec: "json",
    },
    outboundProxy: {},
    langevals: resolveLangevalsRuntimeConfig({}),
    tracePrivacy: resolveTracePrivacyRuntimeConfig({
      googleDlpDisabled: true,
      nodeEnv: "test",
    }),
    nlpLambda: resolveNlpLambdaRuntimeConfig({}),
    featureFlags: resolveFeatureFlagConfig({}),
    scenarioExecution: {
      langwatchEndpoint: "http://localhost:5560",
      nlpServiceUrl: "http://localhost:5561",
      legacyDefaultModel: "openai/gpt-5",
      childEnvironment: {},
    },
    evaluationExecution: { defaultConcurrency: 10 },
    baseHost: "http://localhost:5560",
    codingAgentSpanFilterEnabled: true,
    evaluationInputsOffload: {
      inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
      hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
      previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
    },
    ...overrides?.config,
  };
  const testAws = AppAwsClientConfiguration.create(config.outboundProxy);
  const evaluationInputsOffloadConfig = config.evaluationInputsOffload;
  const testFeatureFlags =
    overrides?.featureFlags ??
    PostgresFeatureFlagAdapter.create({
      database: testPrisma,
      cache: RedisFeatureFlagCacheAdapter.create(null),
      config: config.featureFlags,
      now: Date.now,
    });
  const traceCanonicalisation = TraceCanonicalisationService.create();
  const nlpLambda = createProcessNlpLambdaRuntime({
    config: config.nlpLambda,
    redis: null,
  });

  const testCanonicalOrganizations = AppOrganizationRuntime.create({
    database: testPrisma,
    authz: testAuthz.permissions,
    grants: testAuthz.grants,
  }).build();
  const testProjects = traced(
    AppProjectRuntime.create({
      database: testPrisma,
      generateProjectId: nanoid,
      generateApiKey,
      organizations: testCanonicalOrganizations,
      keyMap: LwqlKeyMapService.create(new NullLwqlKeyMapRepository()),
    }).build(),
    "ProjectService",
  );
  const testDataPrivacy = PrismaDataPrivacyAdapter.create({
    prisma: testPrisma,
    projects: testProjects,
    organizations: testCanonicalOrganizations,
  });
  const testTracePrivacy = AppTracePrivacyRuntime.create({
    config: config.tracePrivacy,
    dataPrivacy: testDataPrivacy,
    featureFlags: testFeatureFlags,
    tokenizer: new NullTokenizerClient(),
  });
  const logRuntime = LogRuntimeAdapter.createUnavailable({
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    logCommandShardCount: resolveLogCommandShardCount(void 0),
    redaction: testTracePrivacy.redaction,
  });
  const metricRuntime = MetricRuntimeAdapter.createUnavailable({
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    metricCommandShardCount: resolveMetricCommandShardCount(void 0),
    redaction: testTracePrivacy.redaction,
  });
  const logs = logRuntime.getService();
  const metrics = metricRuntime.getService();
  const modelProviders = AppModelProviderRuntime.create({
    database: testPrisma,
    organizations: testCanonicalOrganizations,
    projects: testProjects,
    managedProviders,
    systemProviderEnvironment: {},
    isSaas: false,
    permissions: testAuthz.permissions,
  }).build();
  const prompts = AppPromptRuntime.create({
    database: testPrisma,
    modelProvider: modelProviders,
  }).build();
  const testDataRetentionService = PrismaDataRetentionAdapter.create({
    database: testPrisma,
    projects: testProjects,
    organizations: testCanonicalOrganizations,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    cacheTtlMs: 60_000,
    resolveClickHouseClient: null,
  });
  const testShare = PostgresShareAdapter.create({
    database: testPrisma,
    dataRetention: testDataRetentionService,
    projects: testProjects,
    permissions: testAuthz.permissions,
    grants: testAuthz.grants,
    redis: null,
  });
  const nullOrganizations = traced(
    new OrganizationService(
      new NullOrganizationRepository(),
      prompts,
      testCanonicalOrganizations,
      createLicenseEnforcementService(testPrisma),
      testShare,
    ),
    "OrganizationService",
  );
  const apiKeys = AppApiKeyRuntime.create({
    database: testPrisma,
    pepper: "test-api-key-pepper",
    authz: testAuthz.permissions,
    grants: testAuthz.grants,
    organizations: nullOrganizations,
    projects: testProjects,
    deriveBindingId: AuthzFeature.deriveGrantId,
    diagnostics: AppApiKeyDiagnostics.create(createLogger("langwatch:api-key:test")),
  }).build();
  const testGovernanceVirtualKeys = VirtualKeyService.create(
    testPrisma,
    testProjects,
    createProcessVirtualKeyCrypto({ virtualKeyPepper: "test-virtual-key-pepper" }),
  );
  const testGatewayBudgetDecisions = PrismaGatewayAdapter.create({
    database: testPrisma,
    projects: testProjects,
  }).build();
  const testGatewayChanges = createGatewayChangeEventsPort(testPrisma);
  const testGovernanceIngestionPullHost = AppGovernanceIngestionPullHost.create(
    testFeatureFlags,
    testAws,
  );
  const testPlanProvider =
    overrides?.planProvider ??
    PlanProviderService.create({
      getActivePlan: async () => FREE_PLAN,
    });
  const testGovernanceOptions = {
    organizations: nullOrganizations,
    projects: testProjects,
    apiKeys,
    gatewayBaseUrl: "http://localhost:5563",
    virtualKeys: testGovernanceVirtualKeys,
    budgetOverview: BudgetOverviewService.create({
      database: testPrisma,
      budgetDecisions: testGatewayBudgetDecisions,
      organizations: nullOrganizations,
      featureFlags: testFeatureFlags,
      personalVirtualKeys: testGovernanceVirtualKeys,
    }),
    providers: AppGovernanceModelProviderCatalog.create(),
    contacts: AppGovernanceOrganizationContacts.create(testPrisma),
    redis: null,
  };
  const testIngestionSources = AppIngestionSourceAdapter.create({
    plans: testPlanProvider,
    lifecycle: AppIngestionSourceAdapter.disabledLifecycle(),
    secretPepper: "test-ingestion-secret-pepper",
    encryption: testGovernanceIngestionPullHost.encryption,
  });
  const testGovernanceActivity = AppIngestionSourceActivityAdapter.create({
    database: testPrisma,
    resolveClient: async () => null,
  }).clickhouse();
  const testGovernance = AppGovernanceRuntime.create(testPrisma, {
    ...testGovernanceOptions,
    eventing: AppGovernanceEventingAdapter.noopGovernancePort(),
    activityClickhouse: testGovernanceActivity,
    ingestionSourceEntitlements: testIngestionSources.entitlements(),
    ingestionSourceLifecycle: testIngestionSources.lifecycle(),
    ingestionEncryption: testIngestionSources.encryption(),
    ingestionSecretPepper: testIngestionSources.secretPepper(),
    ingestionDiagnostics: testIngestionSources.diagnostics(),
  });
  const testUsers = AppUserRuntimeAdapter.create({
    database: testPrisma,
    redis: null,
    organizations: nullOrganizations,
    governance: testGovernance,
    storedObjects: userAvatarStoredObjects,
  });
  const testBroadcast = new BroadcastService(null);
  // Pull-request linkage against an unconfigured App and null stores: every
  // read answers empty, every write is a no-op, and no test can accidentally
  // reach github.com.
  const testGithub = GithubPrismaInstaller.create({
    database: testPrisma,
    config: {
      appId: "",
      privateKey: "",
      appSlug: "",
      webhookSecret: "",
      signingKey: "",
    },
    redis: null,
    organization: nullOrganizations,
    project: testProjects,
  });
  const testCodingAgents = CodingAgentRuntime.create({
    projections: CodingAgentProjectionPersistenceAdapter.create({
      clickHouse: null,
      retention: { defaultTraceRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS },
    }),
    github: testGithub,
    projects: testProjects,
    billing: AppCodingAgentBillingPolicy.create(testGovernance),
  }).service;
  const testDataset = AppDatasetRuntime.create({
    database: testPrisma,
  }).build();
  const testWorkflowNlpRuntime = AppWorkflowNlpRuntimePort.create(nlpLambda);
  const testWorkflows = AppWorkflowRuntime.create({
    database: testPrisma,
    datasets: testDataset,
    projectEnvironment: AppWorkflowProjectEnvironmentPort.create({
      database: testPrisma,
      encryption: AppWorkflowEnvironmentEncryption.create(),
    }),
    llmParameters: AppWorkflowLlmParametersPort.create({
      modelProviders,
    }),
    modelProviders,
    nlpRuntime: testWorkflowNlpRuntime,
  }).build();
  const agents = AgentsFeature.create({
    prisma: testPrisma,
    session: null,
    workflows: testWorkflows,
  });
  const testEvaluators = EvaluatorFeature.create({
    prisma: testPrisma,
    workflows: testWorkflows,
    nlpRuntime: testWorkflowNlpRuntime,
  });
  const testEvaluationService = AppEvaluationRuntime.create({
    resolveClickHouse: async () => ({
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    }),
    retentionFloor: createRetentionFloorService(testDataRetentionService),
    execution: AppEvaluationExecutionPort.create(async () => ({
      status: "skipped",
    })),
    workflows: testWorkflows,
    featureFlags: testFeatureFlags,
    storedObjects: storedObjectsService,
    inputsOffloadConfig: evaluationInputsOffloadConfig,
  }).build();
  const testMonitors = PostgresMonitorAdapter.create({
    database: testPrisma,
    evaluators: testEvaluators,
    generateId: () => "monitor_test",
  });
  const testSimulations = AppSimulationRuntime.create({
    clickhouseEnabled: false,
    resolveClient: async () => {
      throw new Error("ClickHouse is not available in the test app");
    },
    commands: testSimulationCommands,
  }).build();
  const testScenarioSecretCipher = new AppScenarioSecretCipher();
  const testScenarios = AppScenarioRuntime.create({
    database: testPrisma,
    simulations: testSimulations,
    ids: AppScenarioId.create(() => generate(KSUID_RESOURCES.SCENARIO).toString()),
    folderIds: AppScenarioFolderId.create(() => `suite_${nanoid()}`),
    clock: AppScenarioClock.create(),
    secretCipher: testScenarioSecretCipher,
  }).build();
  const testScenarioTabs = ScenarioTabRegistryService.create({
    store: null,
    clock: AppScenarioClock.create(),
  });
  const testSuiteAdapter = PostgresSuiteAdapter.create({
    database: testPrisma,
    agents,
    prompts,
    scenarios: testScenarios,
    resolveClickHouseClient: null,
    defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    execution: SuiteExecutionService.create({
      commands: AppSuiteRunCommandsPort.create({
        startSuiteRun: overrides?.suiteCommands?.startSuiteRun ?? noop,
        queueSimulationRun: overrides?.suiteCommands?.queueRun ?? noop,
      }),
      ids: new AppSuiteRunIdPort(),
      scenarios: testScenarios,
    }),
    generateId: () => `suite_${nanoid()}`,
  });
  const testSuites = AppSuiteRuntime.create(testSuiteAdapter).build();
  const testLangWatchQL = new LangWatchQLService({
    executor: null,
    database: DEFAULT_LWQL_DATABASE,
  });
  const testProcessStore = PrismaProcessStore.create({ database: testPrismaConnection.client });
  const testTopics = PostgresTopicAdapter.create({
    database: testPrisma,
    schedule: EventingTopicClusteringScheduleAdapter.create({
      processStore: testProcessStore,
    }),
  });
  const testWebhookEndpoints = createEnterpriseWebhookEndpointService({ prisma: testPrisma });
  const testWebhookHealth = WebhookHealthService.create({
    endpoints: testWebhookEndpoints,
    processStore: testProcessStore,
  });
  const testDataRetention: DataRetentionDependencies = testDataRetentionService;
  const testScim = PostgresScimAdapter.create({
    database: testPrisma,
    writer: testAuthz.grants,
    users: testUsers,
    governance: testGovernance,
    entitlements: testPlanProvider,
  }).build();

  const testOpsService = AppOpsRuntime.create({
    database: testPrisma,
    adminEmails: process.env.ADMIN_EMAILS ?? "",
    users: testUsers,
    scheduler: {
      repository: new NullScheduledJobStore(),
      wake: NoopSchedulerWakeService.create(),
      projects: testProjects,
    },
  }).build();
  const testSecrets = AppSecretRuntime.create({ database: testPrisma });
  const testTraceTree = AppTraceRuntime.createNull(modelProviders);
  const testScenarioExecutionPrefetcher = ScenarioExecutionPrefetcherService.create({
    scenarios: testScenarios,
    suites: testSuites,
    prompts,
    agents,
    workflows: testWorkflows,
    projects: testProjects,
    modelProviders,
    secrets: testSecrets,
    traces: testTraceTree,
    secretCipher: testScenarioSecretCipher,
    config: config.scenarioExecution,
  });
  const testScenarioExecution = ScenarioExecutionService.create({
    pool: UnavailableScenarioExecutionPoolService.create(),
    cancellations: UnavailableCancellationPublisherAdapter.create(),
    prefetcher: testScenarioExecutionPrefetcher,
    failures: ScenarioFailureHandlerService.create({
      agents,
      simulations: testSimulations,
    }),
  });
  const shutdownResources = new AppShutdownResources();
  shutdownResources.register("subscriber", "trace-privacy", () => testTracePrivacy.close());
  shutdownResources.register("subscriber", "governance-s3-aws", () => testAws.close());
  shutdownResources.register("database", "prisma", closePrismaConnection);

  return new App({
    config,
    nlpLambda,
    agents,
    dataset: testDataset,
    annotations: PostgresAnnotationAdapter.create({
      database: testPrisma,
      projects: testProjects,
      organizations: testCanonicalOrganizations,
    }).build(),
    workflows: testWorkflows,
    evaluators: testEvaluators,
    monitors: testMonitors,
    apiKeys,
    managedProviders,
    scim: testScim,
    modelProviders,
    prompts,
    broadcast: testBroadcast,
    presence: AppPresenceRuntime.create({
      redis: null,
      broadcast: testBroadcast,
      projects: testProjects,
    }),
    secrets: testSecrets,
    traces: (() => {
      const traceRead = TraceService.create({
        prisma: testPrisma,
        traceCanonicalisation,
        blobResolutionDeps: buildTraceBlobResolutionDeps(traceCanonicalisation, {
          clickhouseEnabled: true,
        }),
      });
      return {
        canonicalisation: traceCanonicalisation,
        read: traceRead,
        export: ExportService.create({ traceService: traceRead }),
        tree: testTraceTree,
        summary: traced(
          new TraceSummaryService(new NullTraceSummaryRepository()),
          "TraceSummaryService",
        ),
        list: traced(
          new TraceListService(
            AppTraceRuntime.createNullListRepository(),
            testEvaluationService,
            testTopics,
          ),
          "TraceListService",
        ),
        sessionGroups: traced(
          new SessionGroupsService({
            repository: new NullSessionGroupsRepository(),
            codingAgentSessions: testCodingAgents,
          }),
          "SessionGroupsService",
        ),
        spans: traced(
          new SpanStorageService(new NullSpanStorageRepository()),
          "SpanStorageService",
        ),
        logRecords: traced(
          new LogRecordStorageService({
            repository: new NullLogRecordStorageRepository(),
            canonical: logs,
          }),
          "LogRecordStorageService",
        ),
        collection: traced(
          AppTraceRuntime.createIngestion({
            codingAgents: testCodingAgents,
            codingAgentSpanFilterEnabled: true,
            dedup: createSpanDedupeService(null),
            recordSpan: noop,
          }),
          "TraceRequestCollectionService",
        ),
        logCollection: traced(
          new LogRequestCollectionService({
            traceCanonicalisation,
            logs,
            recordLogRecords: noop,
            recordLogContributions: noop,
          }),
          "LogRequestCollectionService",
        ),
        metricCollection: traced(
          new MetricRequestCollectionService({
            metrics,
            recordDataPoints: noop,
            recordMetricCorrelations: noop,
          }),
          "MetricRequestCollectionService",
        ),
        editOverlay: TraceEditOverlayService.create(testPrisma),
      };
    })(),
    evaluations: testEvaluationService,
    featureFlags: testFeatureFlags,
    analytics: AnalyticsAdapter.create({
      resolveClient: async () => {
        throw new Error("ClickHouse not available in test app");
      },
      clickhouseEnabled: false,
    }),
    langWatchQL: testLangWatchQL,
    dashboard: PostgresDashboardAdapter.create({
      database: testPrisma,
      ids: { generate: () => nanoid() },
      savedWorkbenchChartPolicy: {
        validate: async ({ projectId, definition }) => {
          validateSavedWorkbenchChartDefinition({
            projectId,
            protections: await getProtectionsForProject(testPrisma, { projectId }),
            definition,
            lwql: testLangWatchQL,
          });
        },
      },
    }).build(),
    experiments: AppExperimentRuntime.create({
      database: testPrisma,
      resolveClickHouseClient: async () => null,
      tupleParam: (values) => new TupleParam(values),
      runHistoryTelemetry: AppExperimentRunHistoryObservability.create(),
      dspyRetention: AppExperimentDspyRetentionPort.create(testDataRetentionService),
      slugify,
      newId: () => nanoid(8),
      references: {
        prompts,
        agents,
        evaluators: testEvaluators,
        workflows: testWorkflows,
        dataset: testDataset,
      },
    }).build(),
    scenarios: testScenarios,
    scenarioTabs: testScenarioTabs,
    scenarioExecution: testScenarioExecution,
    scenarioExecutionPool: null,
    suites: testSuites,
    automation: AppAutomationRuntime.create({
      database: testPrisma,
      redis: null,
      graph: createAutomationTestRuntime(),
      testFire: createAutomationTestFirePort(),
      persistCaps: createAppAutomationTestPersistCaps(),
    }).build(),
    simulations: testSimulations,
    simulationExports: ScenarioRunExportService.create(testSimulations),
    topics: testTopics,
    gateway: {
      virtualKeys: testGovernanceVirtualKeys,
      budgetDecisions: testGatewayBudgetDecisions,
      budgets: undefined,
      changes: testGatewayChanges,
      virtualKeySpend: undefined,
      spendEvents: undefined,
      webhookEvents: undefined,
      webhookEndpoints: testWebhookEndpoints,
      webhookHealth: testWebhookHealth,
      webhookDelivery: undefined,
    },
    filters: { options: new FilterService(null) },
    clickhouse: {
      enabled: false,
      resolveClient: async () => {
        throw new Error("ClickHouse is not available in the test app");
      },
      resolveOrganizationClient: async () => {
        throw new Error("ClickHouse is not available in the test app");
      },
      allInstances: async () => [],
    },
    // No Redis in the test preset; a test that needs one passes it as an
    // override, or injects a double into the unit directly.
    redis: null,
    billing: {
      events: new BillableEventsMeterClickHouseRepository(async () => null),
    },
    governance: testGovernance,
    billableEvents: undefined,
    billingQueries: BillableEventsQueryService.create(null),
    codingAgents: testCodingAgents,
    github: testGithub,
    storedObjects: storedObjectsService,
    userAvatarObjects,
    storedObjectOwners: StoredObjectOwnerLookupRuntime.create({
      instanceDirectory: AppStoredObjectOwnerInstanceDirectory.createUnavailableForTests(),
      telemetry: AppStoredObjectOwnerLookupTracingAdapter.create(),
    }).resolver,
    opsExplain: {
      service: new OpsExplainService(
        new OpsExplainClickHouseRepository(UnavailableOpsExplainClientResolver.create()),
      ),
    },
    langy: PostgresLangyAdapter.create({ database: testPrisma }).build({
      commands: {
        createConversation: noop,
        forkConversation: noop,
        recordMessage: noop,
        importMessage: noop,
        acceptAgentTurn: noop,
        initiateToolCall: noop,
        succeedToolCall: noop,
        failToolCall: noop,
        updatePlan: noop,
        failAgentResponse: noop,
        recordAgentResponse: noop,
        archiveConversation: noop,
        updateConversationMetadata: noop,
        recordTurnHandoff: noop,
        consumeTurnHandoff: noop,
        generateConversationTitle: noop,
      },
      turns: {
        prompts,
        promptProjectId: env.LANGY_PROMPT_PROJECT_ID?.trim(),
        models: {
          resolve: async () => {
            throw new Error("no model provider in test app");
          },
        },
        worker: null,
        tokenBuffer: null,
        permits: {
          reserve: async () => ({
            reserved: false,
            allowed: false,
            resetAt: 0,
          }),
          release: noop,
          check: async () => ({ allowed: false }),
        },
        perDayPrCap: 0,
        sessionKeys: {
          mint: async () => {
            throw new Error("no session-key mint in test app");
          },
          revoke: noop,
        },
        context: { render: renderLangyTurnContext },
        metrics: { count: () => void 0 },
        accessStore: null,
        handoffStore: null,
      },
      credentials: createAppLangyCredentialComposition({
        prisma: testPrisma,
        virtualKeys: testGovernanceVirtualKeys,
        apiKeys,
        github: testGithub,
        workerCallbackUrl:
          env.LANGY_WORKER_CALLBACK_URL ?? env.LANGWATCH_ENDPOINT ?? env.LANGWATCH_API_URL,
        workerGatewayBaseUrl:
          env.LANGY_WORKER_GATEWAY_URL ?? env.LW_GATEWAY_PUBLIC_URL ?? env.LW_GATEWAY_BASE_URL,
        mirrorProjectId: env.LANGY_MIRROR_PROJECT_ID,
      }),
      feedbackPromptRedis: null,
    }),
    organizations: nullOrganizations,
    projects: testProjects,
    users: testUsers,
    roles: testRoles,
    permissions: testAuthz.permissions,
    authzGrants: testAuthz.grants,
    tokenizer: new TokenizerService(testTracePrivacy.tokenizer),
    usage: new UsageService(
      nullOrganizations,
      TraceUsageService.create(),
      new EventUsageService(),
      async () => FREE_PLAN,
      null,
    ),
    planProvider: testPlanProvider,
    subscription: undefined,
    billingCustomer: undefined,
    notifications: NotificationService.createNull(),
    nurturing: undefined,
    usageLimits: UsageLimitService.createNull(),
    ops: Object.assign(testOpsService, {
      eventExplorer: new EventExplorerService(new NullEventExplorerRepository()),
      managerExplorer: new ManagerExplorerService({
        store: InMemoryProcessStore.createForTesting(),
        fleet: new NullProcessOpsRepository(),
        audit: new NullProcessAuditSink(),
      }),
      replay: new ReplayService(
        new NullReplayRepository(),
        AppEventingRetentionAdapter.create(testDataRetentionService),
      ),
      metricsCollector: null,
      snapshots: null,
    }),
    commands: {
      traces: {
        recordSpan: noop,
        assignTopic: noop,
        recordLogContribution: noop,
        recordMetricCorrelation: noop,
        resolveOrigin: noop,
        addAnnotation: noop,
        removeAnnotation: noop,
        bulkSyncAnnotations: noop,
        changeTraceName: noop,
      } satisfies AppCommands["traces"],
      metrics: {
        recordDataPoint: noop,
      } satisfies AppCommands["metrics"],
      logs: {
        recordLogRecord: noop,
      } satisfies AppCommands["logs"],
      codingAgents: {
        contributeSpanFacts: noop,
        contributeLogFacts: noop,
        contributeMetricFacts: noop,
      } satisfies AppCommands["codingAgents"],
      evaluations: {
        executeEvaluation: noop,
        startEvaluation: noop,
        completeEvaluation: noop,
        reportEvaluation: noop,
      } as AppCommands["evaluations"],
      simulations: testSimulationCommands,
      suiteRuns: {
        startSuiteRun: noop,
        recordSuiteRunItemStarted: noop,
        completeSuiteRunItem: noop,
      } as AppCommands["suiteRuns"],
      langy: {
        createConversation: noop,
        forkConversation: noop,
        recordMessage: noop,
        importMessage: noop,
        acceptAgentTurn: noop,
        initiateToolCall: noop,
        succeedToolCall: noop,
        failToolCall: noop,
        updatePlan: noop,
        failAgentResponse: noop,
        recordAgentResponse: noop,
        archiveConversation: noop,
        updateConversationMetadata: noop,
        recordTurnHandoff: noop,
        consumeTurnHandoff: noop,
        generateConversationTitle: noop,
      } as AppCommands["langy"],
      topicClustering: {
        requestClustering: noop,
        recordClusteringRunStarted: noop,
        recordClusteringRunCompleted: noop,
        recordClusteringRunFailed: noop,
        recordTopics: noop,
      } as AppCommands["topicClustering"],
      ingestionPull: AppGovernanceEventingAdapter.noopIngestionPullPipeline(),
      pulledUsage: AppGovernanceEventingAdapter.noopPulledUsagePipeline(),
      billing: {
        reportUsageForMonth: noop,
      } as AppCommands["billing"],
      automations: {
        recordTriggerMatch: noop,
      } as AppCommands["automations"],
    },
    dataRetention: testDataRetention,
    share: testShare,
    _authzMigration: testAuthz.migration,
    _shutdownResources: shutdownResources,
    ...overrides,
  });
}
