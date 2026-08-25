import {
  createEnterpriseWebhookEndpointService,
  installEnterpriseWebhookAccess,
} from "~/server/webhooks/enterpriseWebhookEndpointService";
import { TupleParam, type ClickHouseClient } from "@clickhouse/client";
import { REPORT_SCHEDULER_TARGET_TYPE } from "@langwatch/automation-contract";
import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
} from "@langwatch/enterprise-billing-contract";
import { resolveGatewayBaseUrl } from "@langwatch/enterprise-governance-contract";
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
import { AppGovernanceEventingAdapter } from "~/runtime/app/features/governance/governance-eventing.adapter";
import { AppIngestionPullWorkerAdapter } from "~/runtime/app/features/governance/ingestion-pull-worker.adapter";
import { AppIngestionSourceAdapter } from "~/runtime/app/features/governance/ingestion-source.adapter";
import { AppIngestionSourceActivityAdapter } from "~/runtime/app/features/governance/ingestion-source-activity.adapter";
import { GovernanceKpisClickHouseRepository } from "~/runtime/app/features/governance/governance-kpis.clickhouse.repository";
import { GovernanceOcsfEventsClickHouseRepository } from "~/runtime/app/features/governance/governance-ocsf-events.clickhouse.repository";
import { GovernanceTraceActivityClickHouseRepository } from "~/runtime/app/features/governance/governance-trace-activity.clickhouse.repository";
import { PersonalUsageClickHouseRepository } from "~/runtime/app/features/governance/personal-usage.clickhouse.repository";
import {
  WebhookEventsClickHouseRepository,
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
import {
  AppApiKeyDiagnostics,
  AppApiKeyRuntime,
} from "~/runtime/app/features/api-key";
import { AppAutomationRuntime } from "~/runtime/app/features/automation";
import { AppGovernanceRuntime } from "~/runtime/app/features/governance";
import { AgentsFeature } from "~/runtime/app/features/agents";
import { AppModelProviderRuntime } from "~/runtime/app/features/model-provider";
import { AppOrganizationRuntime } from "~/runtime/app/features/organization";
import { AppProjectRuntime } from "~/runtime/app/features/project";
import { AppRoleRuntime } from "~/runtime/app/features/role";
import { EvaluatorFeature } from "~/runtime/app/features/evaluator";
import {
  AppEvaluationExecutionPort,
  AppEvaluationRuntime,
} from "~/runtime/app/features/evaluation";
import type { EvaluationClickHouseClient } from "@langwatch/evaluation-server";
import {
  AppWorkflowExecutionPort,
  AppWorkflowRuntime,
} from "~/runtime/app/features/workflow";
import {
  AppExperimentDspyRetentionPort,
  AppExperimentRuntime,
} from "~/runtime/app/features/experiment";
import { AppExperimentEventingAdapter } from "~/runtime/app/features/experiment-eventing";
import { AppExperimentRunHistoryTelemetry } from "~/runtime/app/features/experiment-run-history.telemetry";
import { AppScenarioRuntime } from "~/runtime/app/features/scenario";
import { AppSimulationRuntime } from "~/runtime/app/features/simulation";
import { AppSuiteRuntime } from "~/runtime/app/features/suite";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import {
  RedisConnectionService,
  RedisShutdownService,
} from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { slugify } from "~/utils/slugify";
import { env } from "~/env.mjs";
import {
  LangyTurnAccessStore,
  LangyTurnHandoffStore,
  LangyTokenBuffer,
} from "@langwatch/langy-server";
import { AuthzFeature } from "~/runtime/app/features/authz";
import {
  AnalyticsAdapter,
  LoggingAnalyticsTripwire,
} from "@langwatch/analytics-server";
import { PostgresDashboardAdapter } from "@langwatch/dashboard-server";
import { getProtectionsForProject } from "~/server/api/utils";
import { validateSavedWorkbenchChartDefinition } from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import {
  createLangWatchQLService,
  DEFAULT_LWQL_DATABASE,
  LangWatchQLService,
} from "~/server/analytics/lwql";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import { featureFlagService } from "~/server/featureFlag";
import {
  LwqlKeyMapClickHouseRepository,
  NullLwqlKeyMapRepository,
} from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { LwqlKeyMapService } from "~/server/analytics/lwql/lwql-key-map.service";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import { liveTriggerNotifier } from "~/server/app-layer/automations/delivery/triggerNotifier";
import { resolveNavigateFallbackUrl } from "~/server/app-layer/langy/streaming/langyNavigateFallback";
import { resolveLangyCapabilityProgress } from "~/server/app-layer/langy/langy-capability-progress";
import { createAppLangyCredentialComposition } from "~/server/app-layer/langy/langy-credential-adapters";
import {
  mintLangySessionApiKey,
  revokeLangySessionApiKey,
} from "~/server/app-layer/langy/langyApiKey";
import { resolveLangyHarness } from "~/server/app-layer/langy/langyHarness";
import { createLangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import { OpsExplainClickHouseRepository } from "~/server/app-layer/ops/repositories/ops-explain.clickhouse.repository";
import { InstanceUsageStatsClickHouseRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import {
  type ClickHouseClientResolver,
  clearCustomClientCache,
  getAllClickHouseInstances,
  getClickHouseClientForOrganization,
  getClickHouseClientForTenant,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import {
  _getSharedClickHouseClient,
  closeClickHouseClient,
} from "~/server/clickhouse/client";
import { prisma as globalPrisma } from "~/server/db";
import { createLicenseEnforcementService } from "~/server/license-enforcement";
import { createRetentionFloorService } from "~/server/app-layer/clients/clickhouse/retention-floor";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { EventRepositoryClickHouse } from "~/server/event-sourcing/adapters/clickhouse/eventRepositoryClickHouse";
import { EventStoreClickHouse } from "~/server/event-sourcing/adapters/clickhouse/eventStoreClickHouse";
import { PrismaProcessStore } from "~/server/event-sourcing/adapters/postgres/prismaProcessStore";
import { BILLING_REPORTING_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/billing-reporting/pipeline";
import type { LangyConversationProcessingEvent } from "@langwatch/langy-server";
import { createBillingMeterDispatchSubscriber } from "~/server/event-sourcing/registration/global/billingMeterDispatch.subscriber";
import { orgBillableEventsMeterProjection } from "~/server/event-sourcing/registration/global/orgBillableEventsMeter.mapProjection";
import { BillableEventsMeterClickHouseRepository } from "~/server/event-sourcing/registration/global/repositories/billable-events.clickhouse.repository";
import type { PipelineRepositories } from "~/server/event-sourcing/registration/pipelineRegistry";
import {
  type AppCommands,
  PipelineRegistry,
  type ScenarioExecutionPoolHolder,
} from "~/server/event-sourcing/registration/pipelineRegistry";
import { getFeatureFlagStore } from "~/server/featureFlag/featureFlagStore.postgres";
import { FilterService } from "~/server/filters/filter.service";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { createBudgetChangeEventDedupeService } from "~/server/gateway/budgetChangeEventDedupe.service";
import { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import { GatewayVirtualKeySpendRepository } from "~/server/gateway/virtualKeySpend.clickhouse.repository";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { getEdgeSpoolFailOpenCounter } from "~/server/metrics";
import {
  getLangyGithubPrUsage,
  LANGY_GITHUB_PRS_PER_DAY,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { LANGY_CHAT_FEATURE_KEY } from "~/server/modelProviders/codexRestrictions";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import { OpsExplainService } from "~/server/ops/opsExplain.service";
import { getPostHogInstance } from "~/server/posthog";
import { pruneExpiredIdempotencyReceipts } from "~/server/webhooks/deliveryLog";
import { webhookDestinationFor } from "~/server/webhooks/destinations";
import { resolveProjectStorageDestination } from "~/server/stored-objects/project-storage-destination";
import { StoredObjectOwnerClickHouseRepository } from "~/server/stored-objects/repositories/stored-object-owner.clickhouse.repository";
import { AppUserRuntime } from "~/runtime/app/features/user";
import { AppSecretRuntime } from "~/runtime/app/features/secret";
import {
  createStorageRegistry,
  createStoredObjectsService,
} from "~/server/stored-objects/stored-objects-factory";
import { captureException } from "~/utils/posthogErrorCapture";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { KSUID_RESOURCES } from "~/utils/constants";
import { UsageLimitService } from "./billing/enterprise/usage-limit.service";
import { LicensePurchaseService } from "./billing/enterprise/license-purchase.service";
import {
  AppBillingErrorReporter,
  AppUsageLimitEmailAdapter,
} from "./billing/enterprise/billing-runtime.adapter";
import { EESubscriptionService } from "./billing/enterprise/subscription.service";
import {
  EEWebhookService,
  type WebhookService,
} from "./billing/enterprise/webhook.service";
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import { StorageMeterService } from "../data-retention/metering/storageMeter.service";
import { PinnedTraceRepository } from "../data-retention/pinning/pinnedTrace.repository";
import { PinnedTraceService } from "../data-retention/pinning/pinnedTrace.service";
import { DataRetentionPolicyRepository } from "../data-retention/policy/dataRetentionPolicy.repository";
import { DataRetentionPolicyService } from "../data-retention/policy/dataRetentionPolicy.service";
import { RetentionPolicyCache } from "../data-retention/retentionPolicyCache";
import { RetroactiveUpdateService } from "../data-retention/retroactive/retroactiveUpdate.service";
import { buildAutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.wiring";
import { createExperimentRunItemAppendStore } from "../event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import {
  ExperimentIdLookupClickHouseRepository,
  ExperimentRunStateRepositoryClickHouse,
  ExperimentRunStateRepositoryMemory,
  NullExperimentIdLookupRepository,
} from "../event-sourcing/pipelines/experiment-run-processing/repositories";
import { LangyAnalyticsEventAppendStore } from "@langwatch/langy-server";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { SimulationRunMetricsAppendStore } from "../event-sourcing/pipelines/simulation-processing/projections";
import {
  SimulationRunMetricsRepositoryClickHouse,
  SimulationRunStateRepositoryClickHouse,
  SimulationRunStateRepositoryMemory,
} from "../event-sourcing/pipelines/simulation-processing/repositories";
import {
  SuiteRunStateRepositoryClickHouse,
  SuiteRunStateRepositoryMemory,
} from "../event-sourcing/pipelines/suite-run-processing/repositories";
import { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import { InviteService } from "../invites/invite.service";
import { resolveOrganizationId } from "../organizations/resolveOrganizationId";
import { OrganizationRepository } from "../repositories/organization.repository";
import { getLicenseHandler } from "~/runtime/app/licensing";
import { sendLicenseEmail } from "~/server/mailer/licenseEmail";
import { TraceEditOverlayService } from "../traces/edit-overlay/traceEditOverlay.service";
import { EventUsageService } from "../traces/event-usage.service";
import { TraceService } from "../traces/trace.service";
import { TraceUsageService } from "../traces/trace-usage.service";
import {
  createWorkflowTraceId,
  migrateWorkflowDslForExecution,
  WorkflowEvaluationRunner,
  WorkflowNlpExecutor,
} from "../workflows/runWorkflow";
import { stripUnsupportedLLMParamsFromWorkflow } from "../workflows/stripUnsupportedLLMParams";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { nlpgoFetch } from "../nlpgo/nlpgoFetch";
import { App, getApp, globalForApp, initializeApp } from "./app";
import { demoProjectId } from "./authz/demo-project";
import { testFireTrigger } from "./automations/trigger-template.service";
import { PrismaBillingCheckpointService } from "./billing/billingCheckpoint.service";
import { BroadcastService } from "./broadcast/broadcast.service";
import { NullLangevalsClient } from "./clients/langevals/langevals.client";
import { LangEvalsHttpClient } from "./clients/langevals/langevals.http.client";
import { TiktokenClient } from "./clients/tokenizer/tiktoken.client";
import { NullTokenizerClient } from "./clients/tokenizer/tokenizer.client";
import { CodingAgentSessionService } from "./coding-agent/coding-agent-session.service";
import { CodingAgentSessionsListService } from "./coding-agent/coding-agent-sessions-list.service";
import { PullRequestUsageService } from "./coding-agent/pull-request-usage.service";
import { CodingAgentSessionClickHouseRepository } from "./coding-agent/repositories/coding-agent-session.clickhouse.repository";
import { NullCodingAgentSessionRepository } from "./coding-agent/repositories/coding-agent-session.repository";
import {
  CodingAgentSessionEventsClickHouseRepository,
  NullCodingAgentSessionEventsRepository,
} from "./coding-agent/repositories/coding-agent-session-events.repository";
import {
  CodingAgentTraceSessionClickHouseRepository,
  NullCodingAgentTraceSessionRepository,
} from "./coding-agent/repositories/coding-agent-trace-session.repository";
import {
  NullSessionMetricSeriesRepository,
  SessionMetricSeriesClickHouseRepository,
} from "./coding-agent/repositories/session-metric-series.repository";
import {
  type AppConfig,
  createAppConfigFromEnv,
  type ProcessRole,
  roleRunsWorkers,
} from "./config";
import type {
  AppDependencies,
  DataRetentionDependencies,
} from "./dependencies";
import { ManagedProvidersAppAdapter } from "./enterprise/managed-providers.adapter";
import { PrismaEvaluationCostRecorder } from "./evaluations/evaluation-cost.recorder";
import { createDefaultModelEnvResolver } from "./evaluations/evaluation-execution.factories";
import { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import { EvaluationAnalyticsClickHouseRepository } from "./evaluations/repositories/evaluation-analytics.clickhouse.repository";
import { NullEvaluationAnalyticsRepository } from "./evaluations/repositories/evaluation-analytics.repository";
import { EvaluationAnalyticsRollupClickHouseRepository } from "./evaluations/repositories/evaluation-analytics-rollup.clickhouse.repository";
import { NullEvaluationAnalyticsRollupRepository } from "./evaluations/repositories/evaluation-analytics-rollup.repository";
import { FilterOptionsClickHouseRepository } from "./filters/repositories/filter-options.clickhouse.repository";
import { GithubCompositionAdapter } from "@langwatch/github-server";
import type { GithubService } from "@langwatch/github-contract";
import { AppLangyRuntime } from "~/runtime/app/features/langy";
import { AppDatasetRuntime } from "~/runtime/app/features/dataset";
import { AppPromptRuntime } from "~/runtime/app/features/prompt";
import { createLangyConversationTitleGenerator } from "./langy/langy-title-generation.service";
import { LangyTurnService } from "./langy/langy-turn.service";
import { ClickHouseLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.clickhouse.repository";
import { NullLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.repository";
import { CanonicalLogRecordClickHouseRepository } from "./logs/repositories/canonical-log-record.clickhouse.repository";
import { NullCanonicalLogRecordRepository } from "./logs/repositories/canonical-log-record.repository";
import { MetricDataPointClickHouseRepository } from "./metrics/repositories/metric-data-point.clickhouse.repository";
import { NullMetricDataPointRepository } from "./metrics/repositories/metric-data-point.repository";

import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import { BlobStoreService } from "./ops/blob-store.service";
import { EventExplorerService } from "./ops/event-explorer.service";
import {
  ManagerExplorerService,
  OVERDUE_PENDING_MS,
  OVERDUE_WAKE_MS,
} from "./ops/manager-explorer.service";
import { getOpsMetricsCollector } from "./ops/metrics-collector";
import {
  NullProcessAuditSink,
  ProcessAuditRepository,
} from "./ops/process-audit.repository";
import { QueueService } from "./ops/queue.service";
import { QueueAuditRepository } from "./ops/queue-audit.repository";
import { ReplayService } from "./ops/replay.service";
import { BlobStoreRedisRepository } from "./ops/repositories/blob-store.redis.repository";
import { NullBlobStoreRepository } from "./ops/repositories/blob-store.repository";
import { EventExplorerClickHouseRepository } from "./ops/repositories/event-explorer.clickhouse.repository";
import { NullEventExplorerRepository } from "./ops/repositories/event-explorer.repository";
import { ProcessOpsPrismaRepository } from "./ops/repositories/process-ops.prisma.repository";
import { NullProcessOpsRepository } from "./ops/repositories/process-ops.repository";
import { QueueRedisRepository } from "./ops/repositories/queue.redis.repository";
import { NullQueueRepository } from "./ops/repositories/queue.repository";
import { ReplayRedisRepository } from "./ops/repositories/replay.redis.repository";
import { NullReplayRepository } from "./ops/repositories/replay.repository";
import { SchedulerAuditRepository } from "./ops/scheduler-audit.repository";
import { SchedulerOpsService } from "./ops/scheduler-ops.service";
import { SnapshotRedisRepository } from "./ops/snapshot/snapshot.repository";
import { getOpsSnapshotReader } from "./ops/snapshot/snapshot-reader";
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
import { LedgerShareRepository } from "./share/repositories/share.ledger.repository";
import { PrismaShareRepository } from "./share/repositories/share.prisma.repository";
import { ShareService } from "./share/share.service";
import { createShareViewDedupeService } from "./share/share-view-dedupe.service";
import { createSharedTracePayloadCache } from "./share/shared-trace-cache.service";
import { createCompositePlanProvider } from "./subscription/composite-plan-provider";
import { PlanProviderService } from "./subscription/plan-provider";
import { createSelfHostedPlanProvider } from "./subscription/self-hosted-plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import { SuiteRunService } from "./suites/suite-run.service";
import { AppSuiteExecutionPort } from "../suites/suite-run.executor";
import { startSystemMigrations } from "./system-migrations/boot";
import { startTopicClusteringBootSeeds } from "./topic-clustering/bootSeeds";
import { clusterTopicsForProject } from "./topic-clustering/clustering";
import type {
  ClusteringPageOutcome,
  ClusteringRunContext,
} from "./topic-clustering/clustering";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-history-projection.prisma.repository";
import { PrismaTopicClusteringRunProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-projection.prisma.repository";
import { PrismaTopicModelProjectionRepository } from "./topic-clustering/repositories/topic-model-projection.prisma.repository";
import { AppTopicRuntime } from "~/runtime/app/features/topic";
import { maybeExtractSpanMedia } from "./traces/edge-media-extraction";
import { maybeSpool } from "./traces/edge-spool";
import { translateFilterToClickHouse } from "./traces/filter-to-clickhouse";
import { LogRecordStorageService } from "./traces/log-record-storage.service";
import { LogRequestCollectionService } from "./traces/log-request-collection.service";
import { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import { LogRecordStorageClickHouseRepository } from "./traces/repositories/log-record-storage.clickhouse.repository";
import { NullLogRecordStorageRepository } from "./traces/repositories/log-record-storage.repository";
import { SessionGroupsClickHouseRepository } from "./traces/repositories/session-groups.clickhouse.repository";
import { NullSessionGroupsRepository } from "./traces/repositories/session-groups.repository";
import { SpanStorageClickHouseRepository } from "./traces/repositories/span-storage.clickhouse.repository";
import { NullSpanStorageRepository } from "./traces/repositories/span-storage.repository";
import { TraceAnalyticsClickHouseRepository } from "./traces/repositories/trace-analytics.clickhouse.repository";
import { NullTraceAnalyticsRepository } from "./traces/repositories/trace-analytics.repository";
import { TraceAnalyticsRollupClickHouseRepository } from "./traces/repositories/trace-analytics-rollup.clickhouse.repository";
import { NullTraceAnalyticsRollupRepository } from "./traces/repositories/trace-analytics-rollup.repository";
import { TraceListClickHouseRepository } from "./traces/repositories/trace-list.clickhouse.repository";
import { NullTraceListRepository } from "./traces/repositories/trace-list.repository";
import { TraceSummaryClickHouseRepository } from "./traces/repositories/trace-summary.clickhouse.repository";
import { NullTraceSummaryRepository } from "./traces/repositories/trace-summary.repository";
import { SessionGroupsService } from "./traces/session-groups.service";
import { createSpanDedupeService } from "./traces/span-dedupe.service";
import { SpanStorageService } from "./traces/span-storage.service";
import { TokenizerService } from "./traces/tokenizer.service";
import {
  setDiscoverBroadcaster,
  TraceListService,
} from "./traces/trace-list.service";
import { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import { TraceSummaryService } from "./traces/trace-summary.service";
import { traced } from "./tracing";
import { UsageService } from "./usage/usage.service";

/** Keeps the connection's lifecycle lines under the name they had before ADR-093. */
const redisLogger = createLogger("langwatch:redis");

/**
 * Late-bound holder for this pod's scenario execution pool, read by the
 * simulationRunExecution process manager's execute intent.
 * Stored on globalForApp to survive hot-reload in dev (same as the App instance).
 */
export function getScenarioExecutionPool(): ScenarioExecutionPoolHolder | null {
  return (globalForApp as any).__scenarioExecutionPool ?? null;
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

export function initializeDefaultApp(options?: {
  processRole?: ProcessRole;
}): App {
  if (globalForApp.__langwatch_app) return globalForApp.__langwatch_app;

  const prisma = globalPrisma;
  AppAuditLogRuntime.install({ prisma });
  const config = createAppConfigFromEnv({ processRole: options?.processRole });
  const clickhouseEnabled = !!config.clickhouseUrl || isClickHouseEnabled();

  // Resolver: given a tenantId (projectId), returns the right ClickHouse client
  const resolveClickHouseClient: ClickHouseClientResolver = async (
    tenantId: string,
  ): Promise<ClickHouseClient> => {
    const client = await getClickHouseClientForTenant(tenantId);
    if (!client)
      throw new Error(`ClickHouse not available for tenant ${tenantId}`);
    return client;
  };

  const processStore = new PrismaProcessStore(prisma);

  // Bind the clustering page runner once for the Eventing process.
  const runClusteringPage = (params: {
    projectId: string;
    searchAfter?: [number, string];
    runContext?: ClusteringRunContext;
  }): Promise<ClusteringPageOutcome> =>
    clusterTopicsForProject({ ...params, resolveClickHouseClient });

  // ADR-093: the composition root owns the App's Redis connection, and nothing
  // holds one at module scope. Two entry points outside a serving process build
  // their own and close it themselves — `replayPreset` (which needs a
  // standalone client, since its multi-key work CROSSSLOT-rejects on a cluster)
  // and the `migrateObjectStorage` task, which boots no App at all. Both go
  // through the client package; neither is a second live connection in a
  // process this one is serving.
  const redis = new RedisConnectionService({ logger: redisLogger }).connect({
    url: config.redisUrl,
    clusterEndpoints: config.redisClusterEndpoints,
    dbIndex: config.redisDbIndex,
    skip: config.skipRedis,
  });
  const redisShutdown = RedisShutdownService.create();

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
  const modelProviders = AppModelProviderRuntime.create({
    database: prisma,
    managedProviders,
    systemProviderEnvironment: process.env,
    isSaas: env.IS_SAAS === "true",
    permissions: authzFeature.permissions,
  }).build();
  const prompts = AppPromptRuntime.create({
    database: prisma,
    modelProvider: modelProviders,
  }).build();

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
  const organizations = traced(
    new OrganizationService(
      new PrismaOrganizationRepository(prisma, authzFeature.grants),
      prompts,
      canonicalOrganizations,
      licenseEnforcement,
    ),
    "OrganizationService",
  );
  const broadcast = new BroadcastService(redis);
  const projects = traced(
    AppProjectRuntime.create({
      database: prisma,
      generateProjectId: nanoid,
      generateApiKey,
      organizations,
      keyMap: LwqlKeyMapService.create(
        new LwqlKeyMapClickHouseRepository(resolveClickHouseClient),
      ),
      storedObjects: {
        deleteOwnedBy: (input) =>
          createStoredObjectsService(input).deleteOwnedBy(input),
      },
      diagnostics: {
        error: (context, message) =>
          createLogger("langwatch:project").error(context, message),
        capture: (error, context) => captureException(error, { extra: context }),
      },
    }).build(),
    "ProjectService",
  );
  const apiKeyPepper = env.CREDENTIALS_SECRET ?? env.NEXTAUTH_SECRET;
  if (!apiKeyPepper) {
    throw new Error(
      "API key pepper not configured: set CREDENTIALS_SECRET or NEXTAUTH_SECRET",
    );
  }
  const apiKeys = traced(
    AppApiKeyRuntime.create({
      database: prisma,
      pepper: apiKeyPepper,
      authz: authzFeature.permissions,
      grants: authzFeature.grants,
      organizations,
      projects,
      newBindingId: () =>
        generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      deriveBindingId: AuthzFeature.deriveGrantId,
      diagnostics: AppApiKeyDiagnostics.create(
        createLogger("langwatch:api-key"),
      ),
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
  const { blobStore, ioExtractionService } = buildTraceBlobResolutionDeps({
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
  const dataRetentionPolicyRepo = new DataRetentionPolicyRepository(prisma);
  const retentionPolicyCache = new RetentionPolicyCache(
    dataRetentionPolicyRepo,
  );

  const traceSummary = traced(
    new TraceSummaryService(
      clickhouseEnabled
        ? new TraceSummaryClickHouseRepository(resolveClickHouseClient)
        : new NullTraceSummaryRepository(),
      { spanStorageRepository, blobStore, ioExtractionService },
    ),
    "TraceSummaryService",
  );
  const topics = traced(
    AppTopicRuntime.create({
      database: prisma,
      processStore,
    }).build(),
    "TopicService",
  );
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
    void broadcast.broadcastToTenantRateLimited(
      tenantId,
      payload,
      "discover_updated",
    );
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
      canonical: clickhouseEnabled
        ? new CanonicalLogRecordClickHouseRepository(resolveClickHouseClient)
        : new NullCanonicalLogRecordRepository(),
    }),
    "LogRecordStorageService",
  );
  const experiments = traced(
    AppExperimentRuntime.create({
      database: prisma,
      resolveClickHouseClient: clickhouseEnabled
        ? resolveClickHouseClient
        : async () => null,
      tupleParam: (values) => new TupleParam(values),
      runHistoryTelemetry: AppExperimentRunHistoryTelemetry.create(),
      dspyRetention:
        AppExperimentDspyRetentionPort.create(retentionPolicyCache),
      execution: AppExperimentEventingAdapter.create(
        () => commands.experimentRuns,
      ).build(),
      slugify,
      newId: () => nanoid(8),
    }).build(),
    "ExperimentService",
  );
  const scenarios = traced(
    AppScenarioRuntime.create({
      database: prisma,
      generateId: () => generate(KSUID_RESOURCES.SCENARIO).toString(),
    }).build(),
    "ScenarioService",
  );
  const datasetRuntime = AppDatasetRuntime.create({
    database: prisma,
    experiments: {
      getName: async ({ projectId, experimentId }) => {
        const name = (await experiments.getById({
          projectId,
          id: experimentId,
        })).name;
        if (!name) throw new Error(`Experiment ${experimentId} has no name`);
        return name;
      },
    },
  });
  const dataset = traced(datasetRuntime.build(), "DatasetService");
  const workflowNlpExecutor = WorkflowNlpExecutor.create({
    migrateDsl: migrateWorkflowDslForExecution,
    getProjectModelProviders: (projectId) =>
      modelProviders.getForProject({ projectId }),
    stripUnsupportedParams: ({ projectId, workflow }) =>
      stripUnsupportedLLMParamsFromWorkflow({
        prisma,
        projectId,
        workflow,
      }),
    addEnvs,
    dispatchNlp: (input) =>
      nlpgoFetch({
        projectId: input.projectId,
        path: "/studio/execute_sync",
        body: input.body,
        origin: input.origin,
        causalityDepth: input.causalityDepth,
        parentTrace: input.parentTrace,
      }),
    createTraceId: createWorkflowTraceId,
  });
  const workflows = traced(
    AppWorkflowRuntime.create({
      database: prisma,
      datasets: dataset,
      execution: AppWorkflowExecutionPort.create(workflowNlpExecutor),
    }).build(),
    "WorkflowService",
  );
  const evaluators = traced(
    EvaluatorFeature.create({ prisma, workflows }),
    "EvaluatorService",
  );
  const traceService = TraceService.create(prisma, {
    blobStore,
    ioExtractionService,
  });

  const evaluationExecution = traced(
    new EvaluationExecutionService({
      traceService,
      modelEnvResolver: createDefaultModelEnvResolver(),
      langevalsClient: config.langevalsEndpoint
        ? new LangEvalsHttpClient(config.langevalsEndpoint)
        : new NullLangevalsClient(),
      workflowExecutor: WorkflowEvaluationRunner.create(workflows),
    }),
    "EvaluationExecutionService",
  );
  const evaluationService = traced(
    AppEvaluationRuntime.create({
      resolveClickHouse: async (tenantId): Promise<EvaluationClickHouseClient> => {
        const client = await resolveClickHouseClient(tenantId);
        return {
          insert: async (input: Parameters<EvaluationClickHouseClient["insert"]>[0]) =>
            client.insert(input as never),
          query: async (input: Parameters<EvaluationClickHouseClient["query"]>[0]) => {
            const result = await client.query(input as never);
            return {
              json: async <T>() =>
                (await result.json<T>()) as unknown as T[],
            };
          },
        };
      },
      retentionFloor: createRetentionFloorService(retentionPolicyCache),
      execution: AppEvaluationExecutionPort.create((input) =>
        evaluationExecution.executeForTrace({
          ...input,
          mappings: input.mappings as unknown as Parameters<
            EvaluationExecutionService["executeForTrace"]
          >[0]["mappings"],
        }),
      ),
      workflows,
    }).build(),
    "EvaluationService",
  );
  traceService.connectEvaluations(evaluationService);
  const traceList = traced(
    new TraceListService(
      clickhouseEnabled
        ? new TraceListClickHouseRepository(resolveClickHouseClient)
        : new NullTraceListRepository(),
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
    tripwire: LoggingAnalyticsTripwire.create({
      isEnabled: async (projectId) =>
        featureFlagService.isEnabled(
          "release_event_sourced_analytics_read_tripwire",
          { distinctId: projectId, projectId },
        ),
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
  // SuiteRunService is created after pipeline registration (needs startSuiteRun command)

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
    const itemCalculator = SubscriptionItemCalculatorService.create(
      billingCatalogue.prices,
    );
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
    const licensePurchaseService = LicensePurchaseService.create({
      sendLicenseEmail,
      notifyLicensePurchase: (input) =>
        getApp().notifications.sendSlackLicensePurchase(input),
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
  const automation = AppAutomationRuntime.create({
    database: prisma,
    redis,
  }).build();
  const triggerTemplateDeps = {
    baseHost: config.baseHost ?? env.BASE_HOST,
    notifier: liveTriggerNotifier,
  };
  const triggerTemplates = {
    testFire: (input: Parameters<typeof testFireTrigger>[1]) =>
      testFireTrigger(triggerTemplateDeps, input),
  };
  const tokenizer = new TokenizerService(
    config.disableTokenization
      ? new NullTokenizerClient()
      : new TiktokenClient(),
  );

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

  const dataRetentionPolicyService = new DataRetentionPolicyService(
    dataRetentionPolicyRepo,
    retentionPolicyCache,
  );
  const pinnedTraceRepo = new PinnedTraceRepository(prisma);
  // Construct the share repo here (not inside ShareService) so the pinning
  // service can ask "is this trace still shared?" without depending on
  // ShareService — that would close the cycle: ShareService already depends
  // on PinnedTraceService for auto(un)pin.
  // A cut-over organization's links are written through the grants ledger and
  // read off the same compat row as ever (ADR-092 PR 3); everyone else gets
  // the Prisma repository byte for byte.
  const shareRepo = new LedgerShareRepository({
    legacy: new PrismaShareRepository(prisma),
    prisma,
    writer: () => authzFeature.grants,
    authz: authzFeature.permissions,
  });
  const pinnedTraceService = new PinnedTraceService(
    pinnedTraceRepo,
    async ({ projectId, traceId }) => {
      return shareRepo.hasActiveShareForResource({
        projectId,
        resourceType: "TRACE",
        resourceId: traceId,
      });
    },
  );
  const retroactiveUpdateService = new RetroactiveUpdateService(
    clickhouseEnabled ? resolveClickHouseClient : null,
  );
  const storageMeterService = new StorageMeterService({
    resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : null,
  });
  const dataRetention: DataRetentionDependencies = {
    policy: dataRetentionPolicyService,
    pinning: pinnedTraceService,
    retroactive: retroactiveUpdateService,
    metering: storageMeterService,
  };

  const share = traced(
    new ShareService(shareRepo, pinnedTraceService, {
      // Effective sharing = org AND project. Off at either level blocks new
      // links; existing links stop resolving via resolveForViewer. ADR-057.
      isTraceSharingEnabled: async (projectId) => {
        const config = await projects.tryGetTraceSharingConfig(projectId);
        return !!config && config.orgEnabled && config.projectEnabled;
      },
      // Makes `maxViews` count viewings rather than requests, so a recipient
      // refreshing a single-view link doesn't lock themselves out. ADR-057.
      viewDedupe: createShareViewDedupeService(redis),
    }),
    "ShareService",
  );
  const sharedTraceCache = createSharedTracePayloadCache(redis);

  const langyRuntime = AppLangyRuntime.create({ database: prisma });
  const langyPersistence = langyRuntime.eventing();
  const langyAgentUrl = process.env.OPENCODE_AGENT_URL;
  const langyInternalSecret = process.env.LANGY_INTERNAL_SECRET;
  const langyWorker = createLangyWorkerPort({
    agentUrl: langyAgentUrl ?? "",
    internalSecret: langyInternalSecret ?? "",
  });
  const langyHandoffStore = LangyTurnHandoffStore.create({ redis: redis! });
  const langyTokenBuffer = redis ? LangyTokenBuffer.create({ redis }) : null;
  const langyTitleGenerator = createLangyConversationTitleGenerator({
    messages: langyPersistence.trustedMessages,
  });

  // Construct repositories at the composition root — ClickHouse-or-Memory decisions live here.
  const repositories: PipelineRepositories = {
    suiteRunState: clickhouseEnabled
      ? new SuiteRunStateRepositoryClickHouse(resolveClickHouseClient)
      : new SuiteRunStateRepositoryMemory(),
    simulationRunState: clickhouseEnabled
      ? new SimulationRunStateRepositoryClickHouse(resolveClickHouseClient)
      : new SimulationRunStateRepositoryMemory(),
    simulationRunMetricsStore: clickhouseEnabled
      ? new SimulationRunMetricsAppendStore(
          new SimulationRunMetricsRepositoryClickHouse(resolveClickHouseClient),
        )
      : // No ClickHouse → event sourcing is disabled; the append store is a noop.
        {
          append: async () => {
            /* noop */
          },
          bulkAppend: async () => {
            /* noop */
          },
        },
    experimentRunState: clickhouseEnabled
      ? new ExperimentRunStateRepositoryClickHouse(resolveClickHouseClient)
      : new ExperimentRunStateRepositoryMemory(),
    experimentIdLookup: clickhouseEnabled
      ? new ExperimentIdLookupClickHouseRepository(resolveClickHouseClient)
      : new NullExperimentIdLookupRepository(),
    traceSummaryFold: clickhouseEnabled
      ? new TraceSummaryClickHouseRepository(resolveClickHouseClient)
      : traceSummary.repository,
    canonicalLogStorage: clickhouseEnabled
      ? new CanonicalLogRecordClickHouseRepository(resolveClickHouseClient)
      : new NullCanonicalLogRecordRepository(),
    codingAgentSession: clickhouseEnabled
      ? new CodingAgentSessionClickHouseRepository(resolveClickHouseClient)
      : new NullCodingAgentSessionRepository(),
    codingAgentTraceSession: clickhouseEnabled
      ? new CodingAgentTraceSessionClickHouseRepository(resolveClickHouseClient)
      : new NullCodingAgentTraceSessionRepository(),
    sessionMetricSeries: clickhouseEnabled
      ? new SessionMetricSeriesClickHouseRepository(resolveClickHouseClient)
      : new NullSessionMetricSeriesRepository(),
    codingAgentSessionEvents: clickhouseEnabled
      ? new CodingAgentSessionEventsClickHouseRepository(
          resolveClickHouseClient,
        )
      : new NullCodingAgentSessionEventsRepository(),
    metricDataPointStorage: clickhouseEnabled
      ? new MetricDataPointClickHouseRepository({
          resolveClient: resolveClickHouseClient,
          resolveOrganizationClient: getClickHouseClientForOrganization,
        })
      : new NullMetricDataPointRepository(),
    traceAnalyticsRollup: clickhouseEnabled
      ? new TraceAnalyticsRollupClickHouseRepository(resolveClickHouseClient)
      : new NullTraceAnalyticsRollupRepository(),
    traceAnalytics: clickhouseEnabled
      ? new TraceAnalyticsClickHouseRepository(resolveClickHouseClient)
      : new NullTraceAnalyticsRepository(),
    evaluationAnalyticsRollup: clickhouseEnabled
      ? new EvaluationAnalyticsRollupClickHouseRepository(
          resolveClickHouseClient,
        )
      : new NullEvaluationAnalyticsRollupRepository(),
    evaluationAnalytics: clickhouseEnabled
      ? new EvaluationAnalyticsClickHouseRepository(resolveClickHouseClient)
      : new NullEvaluationAnalyticsRepository(),
    experimentRunItemStorage: createExperimentRunItemAppendStore(
      clickhouseEnabled ? resolveClickHouseClient : null,
    ),
    langyConversationState: langyPersistence.langyConversationState,
    langyConversationTurnState: langyPersistence.langyConversationTurnState,
    langyMessageStorage: langyPersistence.langyMessageStorage,
    langyAnalyticsEventStorage: new LangyAnalyticsEventAppendStore(
      clickhouseEnabled
        ? new ClickHouseLangyAnalyticsEventRepository(resolveClickHouseClient)
        : new NullLangyAnalyticsEventRepository(),
      PLATFORM_DEFAULT_RETENTION_DAYS,
    ),
    processStore,
    topicClusteringRunStatus: new PrismaTopicClusteringRunProjectionRepository(
      prisma,
    ),
    topicClusteringRunHistory:
      new PrismaTopicClusteringRunHistoryProjectionRepository(prisma),
    topicModel: new PrismaTopicModelProjectionRepository(prisma),
    langyTurnAdmission: langyPersistence.langyTurnAdmission,
  };

  // The spend-command pipeline projects gateway_spend; it shares the
  // ClickHouse gate because the spend record has no PG fallback (a mutable
  // counter is the failure mode this table exists to replace).
  const gatewaySpend = clickhouseEnabled
    ? {
        repository: new GatewaySpendEventsRepository(resolveClickHouseClient),
      }
    : undefined;

  // The webhook delivery process manager scans the spend table, so it
  // shares the same ClickHouse gate. Registration is global; the per-org
  // enterprise flag is enforced inside the scan (and at the REST surface).
  const webhookEndpointService = createEnterpriseWebhookEndpointService({
    prisma,
  });
  installEnterpriseWebhookAccess(planProvider);
  const webhookDelivery: WebhookDeliveryProcessDeps | undefined =
    clickhouseEnabled
    ? {
        processStore: repositories.processStore,
        endpoints: webhookEndpointService,
        pruneExpiredIdempotencyReceipts: (now: Date) =>
          pruneExpiredIdempotencyReceipts({ prisma, now }),
        dispatch: ({ destination, ...input }) =>
          webhookDestinationFor(destination).send(input),
        getPlan: (organizationId: string) =>
          planProvider.getActivePlan({ organizationId }),
      }
      : undefined;

  // The gateway's ClickHouse-backed repositories, built once and handed out
  // on the App. Every surface - tRPC routers, the REST apps, the CLI auth
  // route - takes these instead of minting its own, which is how REST came to
  // serve stale PG spend for the same budgets the UI showed live (#6248), and
  // how the CLI route ended up with a second copy of the same constructor.
  const gatewayBudgetRepository = clickhouseEnabled
    ? new GatewayBudgetClickHouseRepository(resolveClickHouseClient)
    : undefined;
  const gatewayVirtualKeySpendRepository = clickhouseEnabled
    ? new GatewayVirtualKeySpendRepository(resolveClickHouseClient)
    : undefined;
  const gatewayWebhookEventsRepository = clickhouseEnabled
    ? WebhookEventsClickHouseRepository.create(resolveClickHouseClient)
    : undefined;

  // Gateway budget debits ride the spend pipeline and share its ClickHouse
  // gate: the ledger is the only store spend accrues in.
  const gatewayDebits =
    clickhouseEnabled && gatewayBudgetRepository
      ? {
          prisma,
          budgetCHRepository: gatewayBudgetRepository,
          changeEventDedupe: createBudgetChangeEventDedupeService(redis),
        }
      : undefined;

  // Governance's KPI rollup. One instance for the whole App: the subscriber
  // sync writes through it, the spend-spike anomaly evaluator reads through
  // it — the same repository reference the process manager below takes and
  // `app.governance.kpis` hands out.
  const governanceKpisRepository = clickhouseEnabled
    ? new GovernanceKpisClickHouseRepository(resolveClickHouseClient)
    : undefined;
  const governanceKpisSync = governanceKpisRepository
    ? { governanceKpisRepository }
    : undefined;

  // Governance's OCSF SIEM-export sink. One instance for the whole App: the
  // subscriber sync writes through it, the puller worker and the workspace-view
  // audit trail write through it, and the SIEM export procedure reads
  // through it — the same repository reference the process manager below
  // takes and `app.governance.ocsfEvents` hands out.
  const governanceOcsfEventsRepository = clickhouseEnabled
    ? new GovernanceOcsfEventsClickHouseRepository(resolveClickHouseClient)
    : undefined;
  const governanceOcsfEventsSync = governanceOcsfEventsRepository
    ? { governanceOcsfEventsRepository }
    : undefined;

  // Governance-domain reads over the shared `trace_summaries` table (the
  // persona-detection activity probe, the quarantine-fill breakdown).
  const governanceTraceActivityRepository = clickhouseEnabled
    ? new GovernanceTraceActivityClickHouseRepository(resolveClickHouseClient)
    : undefined;

  // The /me dashboard's spend/token/model rollups, over trace_summaries
  // and the gateway ledger's PRINCIPAL rows.
  const personalUsageRepository = clickhouseEnabled
    ? new PersonalUsageClickHouseRepository(resolveClickHouseClient)
    : undefined;
  const governanceActivity = AppIngestionSourceActivityAdapter.create({
    database: prisma,
    resolveClient: async (organizationId) =>
      clickhouseEnabled
        ? getClickHouseClientForOrganization(organizationId)
        : null,
  }).build();

  // Governance is composed once for the process. Request transports receive
  // these same capabilities through `ctx.app`; background pipelines receive
  // the same project and worker instances directly.
  const governanceRuntime = AppGovernanceRuntime.create(prisma, {
    organizations,
    projects,
    apiKeys,
    setupActivity: governanceTraceActivityRepository,
    ocsfEvents: governanceOcsfEventsRepository,
    traceActivity: governanceTraceActivityRepository,
    personalUsage: personalUsageRepository,
    budgetRepository: gatewayBudgetRepository,
    gatewayBaseUrl: resolveGatewayBaseUrl({
      publicUrl: env.LW_GATEWAY_PUBLIC_URL,
      baseUrl: env.LW_GATEWAY_BASE_URL,
      isSaas: config.isSaas,
    }),
    redis,
    ottl: {
      baseUrl: env.LW_GATEWAY_INTERNAL_URL ?? env.LW_GATEWAY_BASE_URL,
      secret: env.LW_GATEWAY_INTERNAL_SECRET,
    },
  });
  const users = AppUserRuntime.create({
    database: prisma,
    redis,
    organizations,
    cliTokenRevocation: governanceRuntime.cliTokenRevocation,
  });
  const secrets = AppSecretRuntime.create({ database: prisma });
  const ingestionPullWorker = AppIngestionPullWorkerAdapter.create({
    database: prisma,
    projects: governanceRuntime.projects,
    events: governanceOcsfEventsRepository,
  }).build();

  // Billing-month usage rollups (billable_events + trace_summaries),
  // read by the billing pipeline and the usage-limit services.
  const billableEventsRepository = clickhouseEnabled
    ? ClickHouseBillingAdapter.create({
        resolveClient: resolveClickHouseClient,
        resolveOrganizationClient: getClickHouseClientForOrganization,
      }).build()
    : null;
  const billingQueries = BillableEventsQueryService.create(
    billableEventsRepository,
  );

  const eventStore = clickhouseEnabled
    ? new EventStoreClickHouse(
        new EventRepositoryClickHouse(resolveClickHouseClient),
        retentionPolicyCache,
      )
    : undefined;
  const configuredGlobalConcurrency = Number(
    process.env.GLOBAL_QUEUE_CONCURRENCY,
  );
  const queueFactory = redis
    ? createEventingGroupQueueFactory({
        consumersEnabled: roleRunsWorkers(config.processRole),
        dependencies: {
          redis,
          policy: {
            globalConcurrency:
              Number.isSafeInteger(configuredGlobalConcurrency) &&
              configuredGlobalConcurrency > 0
                ? configuredGlobalConcurrency
                : undefined,
            compression:
              process.env.GROUP_QUEUE_ZSTD_WRITES_ENABLED === "true"
                ? "zstd"
                : "gzip",
            payloadCodec:
              process.env.GROUP_QUEUE_MSGPACK_WRITES_ENABLED === "true"
                ? "msgpack"
                : "json",
          },
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
    executionTarget:
      config.processRole === "all" ? undefined : config.processRole,
    replayMarkerChecker: redis
      ? new RedisReplayMarkerChecker(redis)
      : undefined,
    retentionPolicyResolver: retentionPolicyCache,
    configureGlobalProjections: config.isSaas
      ? (registry) => {
          registry.registerMapProjection(orgBillableEventsMeterProjection);
          registry.registerMapSubscriber(
            "orgBillableEventsMeter",
            createBillingMeterDispatchSubscriber({
              getDispatch: () => {
                const pipeline = es.getPipeline(
                  BILLING_REPORTING_PIPELINE_NAME,
                );
                return (data) =>
                  pipeline.commands.reportUsageForMonth.send(data);
              },
            }),
          );
        }
      : undefined,
    processStore: repositories.processStore,
  });

  // ADR-052: automation dispatch ports for the process-manager runtime the
  // registry composes (triggerSettlement + graphAlertSweep). Built on every
  // role — registration is passive shape; the outbox/wake worker loops
  // start only where roleRunsWorkers() is true.
  const automationPorts = buildAutomationDispatchPorts({
    prisma,
    redis: redis ?? null,
    automation,
    projects,
    evaluations: evaluationService,
    traces: { spans: spanStorage },
    traceSummaryRepository: repositories.traceSummaryFold,
    analytics: analyticsService,
    resolveClickHouseClient,
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
            loadProject: (projectId) =>
              prisma.project.findUnique({ where: { id: projectId } }),
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
            listReportTraces: async ({
              projectId,
              projectSlug,
              query,
              from,
              to,
              limit,
            }) => {
              const page = await traceList.getList({
                tenantId: projectId,
                timeRange: { from, to },
                sort: { columnId: "time", direction: "desc" },
                page: 1,
                pageSize: limit,
                visibilityCutoffMs: null,
                filterWhere:
                  translateFilterToClickHouse(query, projectId, { from, to }) ??
                  undefined,
              });
              const projectUrl = `${config.baseHost ?? env.BASE_HOST}/${projectSlug}`;
              return page.items.map((item) =>
                toReportTraceRow({ item, projectUrl }),
              );
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
                  getTimeseries: (input) =>
                    analyticsService.getTimeseries(input),
                },
                source,
                projectId,
                from,
                to,
              }),
            baseHost: config.baseHost ?? env.BASE_HOST,
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

  // The coding-agent pipeline's pull-request mapping subscriber fires against a
  // service composed further down (it needs the GitHub connection, which needs
  // Redis and Prisma), so the registry is handed the callable proxy now and the
  // real implementation is wired once it exists.
  const requestBranchMapping = new Deferred<
    GithubService["requestBranchMapping"]
  >("requestBranchMapping");

  // The fleet-wide linkage maintenance the scheduled process manager drives.
  // Late-bound for the same reason: both need the mapping service and its
  // repository, which are composed further down.
  const recheckDueBranches = new Deferred<() => Promise<number>>(
    "recheckDueBranches",
  );
  const pruneStaleBranchLinkage = new Deferred<
    () => Promise<{ branchChecks: number }>
  >("pruneStaleBranchLinkage");

  const registry = new PipelineRegistry({
    eventSourcing: es,
    authz: {
      pipeline: authzFeature.pipeline,
      connect: (authzCommands) => authzFeature.connect(authzCommands as never),
    },
    repositories,
    redis: redis!,
    broadcast,
    codingAgent: {
      pullRequestMapping: {
        requestBranchMapping: (params) => requestBranchMapping.fn(params),
      },
    },
    github: {
      recheckDueBranches: () => recheckDueBranches.fn(),
      pruneStaleBranchLinkage: () => pruneStaleBranchLinkage.fn(),
    },
    langy: {
      buffer: langyTokenBuffer,
      handoffStore: langyHandoffStore,
      worker: langyWorker,
      titleGenerator: langyTitleGenerator,
    },
    automations: {
      ports: automationPorts,
    },
    datasetNormalization: {
      process: (payload) => datasetRuntime.processNormalization(payload),
      connect: (sender) => datasetRuntime.connectNormalization(sender),
    },
    topicClustering: {
      runPort: {
        runClusteringPage: ({ projectId, searchAfter, runId, page }) =>
          runClusteringPage({
            projectId,
            searchAfter: searchAfter ?? undefined,
            runContext: { runId, page },
          }),
      },
    },
    enterprisePipelines: {
      database: prisma,
      runsWorkers: roleRunsWorkers(config.processRole),
      worker: ingestionPullWorker,
      resolveTenantId: async (organizationId) =>
        (
          await governanceRuntime.projects.ensureInternal({
            organizationId,
            kind: "internal_governance",
          })
        ).id,
      // Pulled provider cost shares the gateway debits' ClickHouse gate: it
      // lands in the same ledger table, so without ClickHouse there is nowhere
      // for it to go. The pipeline still records every observation on the log.
      pulledUsageLedger: gatewayBudgetRepository,
    },
    projects,
    monitors,
    automation,
    prisma,
    organizations,
    traces: { summary: traceSummary, spans: spanStorage },
    evaluations: evaluationService,
    costRecorder: new PrismaEvaluationCostRecorder(prisma),
    billingCheckpoints: new PrismaBillingCheckpointService(prisma),
    usageReportingService,
    gatewaySpend,
    webhookDelivery,
    gatewayDebits,
    // ADR-022: Inject BlobStore into the pipeline registry so RecordSpanCommand
    // can reconstitute oversized commands (fetch from transient S3 spool) and
    // best-effort delete the spool after event_log INSERT succeeds.
    blobStore,
    governanceKpisSync,
    governanceOcsfEventsSync,
  });
  const commands = registry.registerAll();
  const ingestionSources = AppIngestionSourceAdapter.create({
    database: prisma,
    projects: governanceRuntime.projects,
    plans: planProvider,
    lifecycle: registry.getGovernanceLifecycle(),
    secretPepper: env.LW_VIRTUAL_KEY_PEPPER ?? "",
  }).build();
  (globalForApp as any).__scenarioExecutionPool =
    commands.scenarioExecutionPool;

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
    // pre-cutover projects. The module owns its own wiring, coordination,
    // and error handling — a failure is logged and the next boot retries.
    startTopicClusteringBootSeeds({
      prisma,
      redis: redis ?? null,
      commands: {
        recordTopics: (args) => commands.topicClustering.recordTopics(args),
        requestClustering: (args) =>
          commands.topicClustering.requestClustering(args),
      },
    });
  }

  // The organization's GitHub connection: the install/webhook lifecycle, and
  // the token mints Langy (write) and pull-request linkage (read) ask for. The
  // App is optional per instance; when the private key is unset the service
  // reports `configured=false` and every read short-circuits to "GitHub
  // unavailable" without touching GitHub. The App private key is the only
  // credential and it lives here in the control plane, never near a worker.
  let github: GithubService | null = null;
  const langyCredentialComposition = createAppLangyCredentialComposition({
    prisma,
    github: () => {
      if (!github) throw new Error("GitHub service has not been composed");
      return github;
    },
    workerCallbackUrl:
      env.LANGY_WORKER_CALLBACK_URL ??
      env.LANGWATCH_ENDPOINT ??
      env.LANGWATCH_API_URL,
    workerGatewayBaseUrl:
      env.LANGY_WORKER_GATEWAY_URL ??
      env.LW_GATEWAY_PUBLIC_URL ??
      env.LW_GATEWAY_BASE_URL,
    mirrorProjectId: env.LANGY_MIRROR_PROJECT_ID,
  });

  // Langy turn-start orchestration (ADR-046): the pipeline the
  // Hono route used to inline, now an app-layer service with injected ports. The
  // worker port + turn stores are null when their infra is absent (no agent env /
  // no Redis); the service raises LangyAgentUnavailableError in that case, exactly
  // as the route 503'd.
  let processApp: App | null = null;
  const langyService = langyRuntime.build({
    commands: commands.langy,
    events: es.getEventStore<LangyConversationProcessingEvent>() ?? null,
    relay: redis
      ? {
          redis,
          baseHost: config.baseHost ?? env.BASE_HOST,
          resolveCapabilityProgress: resolveLangyCapabilityProgress,
          resolveResourceUrl: (input) => {
            if (!processApp) return Promise.resolve(null);
            return resolveNavigateFallbackUrl({
              app: processApp,
              ...input,
            });
          },
          logger: createLogger("langwatch:langy:relay"),
        }
      : undefined,
    credentials: langyCredentialComposition,
    turns: (ports) =>
      LangyTurnService.create({
        conversations: ports.conversations,
        credentials: ports.credentials,
        // ADR-050 versioned prompts. Only consulted when LANGY_PROMPT_PROJECT_ID
        // names the project holding the rows; unset (the default) skips the
        // registry entirely and the in-repo text is used verbatim.
        prompts,
        resolveModel: ({ projectId }) =>
          getVercelAIModel({ projectId, featureKey: LANGY_CHAT_FEATURE_KEY }),
        worker: langyAgentUrl && langyInternalSecret ? langyWorker : null,
        tokenBuffer: redis ? langyTokenBuffer : null,
        reservePermit: reserveLangyGithubPrPermit,
        releasePermit: releaseLangyGithubPrPermit,
        checkPermit: getLangyGithubPrUsage,
        resolveHarness: resolveLangyHarness,
        perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
        mintSessionKey: ({ session, projectId, organizationId }) =>
          mintLangySessionApiKey({ prisma, session, projectId, organizationId }),
        revokeSessionKey: ({ apiKeyId, projectId }) =>
          revokeLangySessionApiKey({ prisma, apiKeyId, projectId }).then(
            () => undefined,
          ),
        admission: ports.admission,
        accessStore: redis ? LangyTurnAccessStore.create({ redis }) : null,
        handoffStore: redis ? langyHandoffStore : null,
        messages: ports.messages,
      }),
    feedbackPromptRedis: redis,
  });

  const suiteRunService = SuiteRunService.create({
    resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : null,
    startSuiteRun: commands.suiteRuns.startSuiteRun,
    queueSimulationRun: commands.simulations.queueRun,
  });
  const simulations = traced(
    AppSimulationRuntime.create({
      clickhouseEnabled,
      resolveClient: resolveClickHouseClient,
      commands: commands.simulations,
    }).build(),
    "SimulationService",
  );
  const simulationExports = ScenarioRunExportService.create(simulations);

  const traceCollection = traced(
    new TraceRequestCollectionService({
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
      processCommandData: async (data) => {
        // Media extraction runs FIRST: externalizing inline media parts to
        // the content-addressed stored-objects store usually brings the
        // payload back under COMMAND_INLINE_THRESHOLD, so the transient
        // whole-payload spool below rarely needs to fire. Internally
        // fail-open (marker-gated, flag-gated, privacy-interlocked) — on any
        // error it returns `data` unchanged and the spool proceeds as today.
        data = await maybeExtractSpanMedia({
          data,
          logger: createLogger("langwatch:traces:edge-media-extraction"),
        });

        // Track which stage failed so the fail-open counter carries a useful
        // reason label (flag_store vs spool/S3) for alerting (GtVrL).
        let stage: "flag_store" | "spool" = "flag_store";
        try {
          const enabled = await getFeatureFlagStore().getOrRegistryDefault(
            "release_trace_blob_offload",
            { projectId: data.tenantId },
          );
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
      },
    }),
    "TraceRequestCollectionService",
  );

  const logCollection = traced(
    new LogRequestCollectionService({
      recordLogRecords: commands.logs.recordLogRecord.sendBatch!,
      recordLogContributions: commands.traces.recordLogContribution.sendBatch!,
    }),
    "LogRequestCollectionService",
  );

  const metricCollection = traced(
    new MetricRequestCollectionService({
      recordDataPoints: commands.metrics.recordDataPoint.sendBatch!,
      recordMetricCorrelations:
        commands.traces.recordMetricCorrelation.sendBatch!,
    }),
    "MetricRequestCollectionService",
  );

  // Hoisted out of the `codingAgents` bag below: the Sessions lens rollup
  // enriches session rows with these pre-folded counters, so both reads
  // share the one service instance.
  const codingAgentSessions = traced(
    new CodingAgentSessionService({
      sessions: repositories.codingAgentSession,
      traceSessions: repositories.codingAgentTraceSession,
      metricSeries: repositories.sessionMetricSeries,
      sessionEvents: repositories.codingAgentSessionEvents,
    }),
    "CodingAgentSessionService",
  );

  const githubService = GithubCompositionAdapter.create({
    database: prisma,
    config: {
      appId: env.GITHUB_LANGY_APP_ID ?? "",
      privateKey: env.GITHUB_LANGY_PRIVATE_KEY ?? "",
    },
    redis: (redis ?? null) as never,
    hostConfig: { host: env.GITHUB_LANGY_HOST },
    organization: organizations,
    project: projects,
    codingAgent: codingAgentSessions,
  });
  github = githubService;
  requestBranchMapping.resolve((params) => githubService.requestBranchMapping(params));
  recheckDueBranches.resolve(() => githubService.recheckDueBranches());
  pruneStaleBranchLinkage.resolve(() => githubService.pruneStaleBranchLinkage());

  const pullRequestUsage = new PullRequestUsageService({
    pullRequests: githubService,
    sessions: repositories.codingAgentSession,
    personalSessions: codingAgentSessions,
    sessionEvents: repositories.codingAgentSessionEvents,
    installations: githubService,
    resolveOrganizationId,
    // The one place the bundled-plan policy is reached: the service takes the
    // answer as a dep so the read stays free of the enterprise module, and the
    // receiver and this rollup resolve bundled-ness the same way.
    isSourceNonBillable: (input) =>
      governanceRuntime.resolveSourceNonBillable(input),
  });

  // The Sessions screen's read: the same session service, plus the mapping
  // lookup the sessions lens joins with, so both surfaces answer "which pull
  // request" from one place.
  const codingAgentSessionsList = traced(
    new CodingAgentSessionsListService({
      sessions: codingAgentSessions,
      pullRequests: githubService,
      resolveOrganizationId,
    }),
    "CodingAgentSessionsListService",
  );

  const sessionGroups = traced(
    new SessionGroupsService({
      repository: clickhouseEnabled
        ? new SessionGroupsClickHouseRepository(resolveClickHouseClient)
        : new NullSessionGroupsRepository(),
      codingAgentSessions,
      pullRequests: githubService,
      resolveOrganizationId,
    }),
    "SessionGroupsService",
  );

  const traces = {
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

  // Collect closeables for graceful shutdown
  const gracefulCloseables: Array<{
    name: string;
    close: () => Promise<void>;
  }> = [];
  gracefulCloseables.push({
    name: "langwatchql",
    close: () => langWatchQL.close(),
  });
  if (clickhouseEnabled) {
    gracefulCloseables.push({
      name: "clickhouse",
      close: async () => {
        await clearCustomClientCache();
        await closeClickHouseClient();
      },
    });
  }
  // BEFORE the Redis closeable, deliberately: stopping the writer hands the
  // snapshot lease back, and a released lease is the difference between the
  // fleet electing a new writer immediately and going without one for the
  // remainder of the lease window — the rolling-deploy case. Once Redis is
  // disconnected the release can no longer be issued at all.
  gracefulCloseables.push({
    name: "ops-snapshot",
    close: async () => {
      await ops.metricsCollector?.stop();
      ops.snapshotReader?.stop();
    },
  });
  if (redis) {
    gracefulCloseables.push({
      name: "redis",
      close: () => redisShutdown.shutdown(redis),
    });
  }
  gracefulCloseables.push({
    name: "broadcast",
    close: async () => {
      await broadcast.close();
    },
  });
  if (scheduler) {
    gracefulCloseables.push({
      name: "scheduler",
      close: () => scheduler.stop(),
    });
  }
  if (systemMigrations) {
    // Aborts the pass between tenants; a truncated pass is harmless because
    // every migration is idempotent and the next boot resumes the sweep.
    gracefulCloseables.push({
      name: "system-migrations",
      close: () => systemMigrations.stop(),
    });
  }
  gracefulCloseables.push({
    name: "prisma",
    close: () => prisma.$disconnect(),
  });

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
    baseHost: config.baseHost ?? env.BASE_HOST,
  });

  const queueRepo = redis
    ? new QueueRedisRepository(redis)
    : new NullQueueRepository();
  const replayRepo = redis
    ? new ReplayRedisRepository(redis)
    : new NullReplayRepository();
  // One snapshot store shared by this pod's writer and its reader: the writer
  // publishes only while it holds the lease, the reader always reads.
  const snapshotRepo = redis ? new SnapshotRedisRepository(redis) : null;
  const sharedCh = _getSharedClickHouseClient();
  const eventExplorerRepo = sharedCh
    ? new EventExplorerClickHouseRepository(sharedCh)
    : new NullEventExplorerRepository();

  const ops = {
    queues: new QueueService({
      repo: queueRepo,
      audit: new QueueAuditRepository(prisma),
    }),
    scheduler: new SchedulerOpsService({
      repo: new PrismaScheduledJobStore(prisma),
      audit: new SchedulerAuditRepository(prisma),
      // Best-effort poke so a manual run fires now rather than within one poll
      // backstop. Latency only: the loop picks the row up either way.
      wake: redis ? () => void SchedulerService.publishWake(redis) : null,
      resolveProjectNames: async (projectIds) => {
        const projects = await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        });
        return new Map(projects.map((p) => [p.id, p.name]));
      },
    }),
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
    replay: new ReplayService(replayRepo),
    blobStore: new BlobStoreService(
      redis
        ? new BlobStoreRedisRepository(redis)
        : new NullBlobStoreRepository(),
    ),
    metricsCollector: redis
      ? getOpsMetricsCollector({ redis, queueRepo, snapshotRepo })
      : null,
    snapshotReader:
      redis && snapshotRepo ? getOpsSnapshotReader(snapshotRepo) : null,
  };

  const agents = AgentsFeature.create({
    prisma,
    session: null,
    workflows,
  });
  const suites = traced(
    AppSuiteRuntime.create({
      database: prisma,
      agents,
      prompts,
      scenarios,
      execution: AppSuiteExecutionPort.create({
        suiteRuns: suiteRunService,
      }),
      generateId: () => `suite_${nanoid()}`,
    }).build(),
    "SuiteService",
  );

  const app = initializeApp({
    config,
    agents,
    dataset,
    workflows,
    evaluators,
    monitors,
    broadcast,
    presence,
    traces,
    evaluations: evaluationService,
    experiments,
    scenarios,
    suites,
    automation,
    triggerTemplates,
    analytics: analyticsService,
    langWatchQL,
    dashboard: dashboardService,
    simulations,
    simulationExports,
    suiteRuns: { runs: suiteRunService },
    topics,
    gateway: {
      budgetOverview: governanceRuntime.budgetOverview,
      budgetDecisions: GatewayBudgetService.create(
        prisma,
        gatewayBudgetRepository,
      ),
      budgets: gatewayBudgetRepository,
      virtualKeySpend: gatewayVirtualKeySpendRepository,
      spendEvents: gatewaySpend?.repository,
      webhookEvents: gatewayWebhookEventsRepository,
    },
    filters: {
      options: new FilterService(
        clickhouseEnabled
          ? new FilterOptionsClickHouseRepository(resolveClickHouseClient)
          : null,
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
      events: new BillableEventsMeterClickHouseRepository(
        getClickHouseClientForOrganization,
      ),
    },
    usageStats: {
      instance: new InstanceUsageStatsClickHouseRepository(
        getClickHouseClientForOrganization,
      ),
    },
    governance: {
      activity: governanceActivity,
      ingestionTemplates: governanceRuntime.ingestionTemplates,
      ingestionSources,
      setupState: governanceRuntime.setupState,
      ocsfExport: governanceRuntime.ocsfExport,
      ottlGateway: governanceRuntime.ottlGateway,
      policy: governanceRuntime.policy,
      canonicalCostExtractor: governanceRuntime.canonicalCostExtractor,
      ocsfEvents: governanceOcsfEventsRepository,
      traceActivity: governanceTraceActivityRepository,
      kpis: governanceKpisRepository,
      personalUsage: governanceRuntime.personalUsage,
      routingPolicies: governanceRuntime.routingPolicies,
      personalVirtualKeys: governanceRuntime.personalVirtualKeys,
      aiTools: governanceRuntime.aiTools,
      cliBootstrap: governanceRuntime.cliBootstrap,
      cliSessions: governanceRuntime.cliSessions,
      cliTokenRevocation: governanceRuntime.cliTokenRevocation,
      adminWorkspaceViewAudit: governanceRuntime.adminWorkspaceViewAudit,
      quarantineFill: governanceRuntime.quarantineFill,
      ingestionKeys: governanceRuntime.ingestionKeys,
    },
    billableEvents: billableEventsRepository ?? undefined,
    billingQueries,
    codingAgents: {
      sessions: codingAgentSessions,
      sessionsList: codingAgentSessionsList,
      pullRequestUsage: traced(pullRequestUsage, "PullRequestUsageService"),
    },
    github: githubService,
    storedObjects: {
      crossTenantOwnerLookup: new StoredObjectOwnerClickHouseRepository(
        getAllClickHouseInstances,
      ),
    },
    opsExplain: {
      service: new OpsExplainService(
        new OpsExplainClickHouseRepository({
          fallbackClient: _getSharedClickHouseClient,
        }),
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
    modelProviders,
    prompts,
    nurturing,
    usageLimits,
    retentionPolicyCache,
    dataRetention,
    share,
    sharedTraceCache,
    commands,
    ops,
    _eventSourcing: es,
    _authzMigration: authzFeature.migration,
    _gracefulCloseables: gracefulCloseables,
  });
  processApp = app;
  return app;
}

/** Tests — noop commands, null-backed services. */
export function createTestApp(overrides?: Partial<AppDependencies>): App {
  const testPrisma = globalPrisma;
  AppAuditLogRuntime.install({ prisma: testPrisma });
  const testRetentionPolicyRepo = new DataRetentionPolicyRepository(testPrisma);
  const testRetentionPolicyCache = new RetentionPolicyCache(
    testRetentionPolicyRepo,
  );
  // Single PinnedTraceService instance shared between dataRetention.pinning
  // and share, mirroring the production wiring (presets.ts above). Without
  // this, tests that auto-pin via share would see a different repo state
  // than tests that pin directly through dataRetention.pinning.
  const testPinnedTraceService = new PinnedTraceService(
    new PinnedTraceRepository(testPrisma),
  );
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
  const managedProviders = ManagedProvidersAppAdapter.create({
    prisma: testPrisma,
    environment: {},
  }).service;
  const modelProviders = AppModelProviderRuntime.create({
    database: testPrisma,
    managedProviders,
    systemProviderEnvironment: {},
    isSaas: false,
    permissions: testAuthz.permissions,
  }).build();
  const prompts = AppPromptRuntime.create({
    database: testPrisma,
    modelProvider: modelProviders,
  }).build();
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
    nodeEnv: "test",
    databaseUrl: "postgresql://test@localhost/test",
    ...overrides?.config,
  };

  const testCanonicalOrganizations = AppOrganizationRuntime.create({
    database: testPrisma,
    authz: testAuthz.permissions,
    grants: testAuthz.grants,
  }).build();
  const nullOrganizations = traced(
    new OrganizationService(
      new NullOrganizationRepository(),
      prompts,
      testCanonicalOrganizations,
      createLicenseEnforcementService(testPrisma),
    ),
    "OrganizationService",
  );
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
  const apiKeys = AppApiKeyRuntime.create({
    database: testPrisma,
    pepper: "test-api-key-pepper",
    authz: testAuthz.permissions,
    grants: testAuthz.grants,
    organizations: nullOrganizations,
    projects: testProjects,
    newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
    deriveBindingId: AuthzFeature.deriveGrantId,
    diagnostics: AppApiKeyDiagnostics.create(
      createLogger("langwatch:api-key:test"),
    ),
  }).build();
  const testGovernanceRuntime = AppGovernanceRuntime.create(testPrisma, {
    organizations: nullOrganizations,
    projects: testProjects,
    apiKeys,
    gatewayBaseUrl: "http://localhost:5563",
    redis: null,
  });
  const testUsers = AppUserRuntime.create({
    database: testPrisma,
    redis: null,
    organizations: nullOrganizations,
    cliTokenRevocation: testGovernanceRuntime.cliTokenRevocation,
  });
  const testIngestionSources = AppIngestionSourceAdapter.create({
    database: testPrisma,
    projects: testGovernanceRuntime.projects,
    plans: {
      getActivePlan: async () => FREE_PLAN,
    },
    lifecycle: { sync: async () => undefined },
    secretPepper: "test-ingestion-secret-pepper",
  }).build();
  const testGovernanceActivity = AppIngestionSourceActivityAdapter.create({
    database: testPrisma,
    resolveClient: async () => null,
  }).build();
  const testBroadcast = new BroadcastService(null);
  const testCodingAgentSessions = new CodingAgentSessionService({
    sessions: new NullCodingAgentSessionRepository(),
    traceSessions: new NullCodingAgentTraceSessionRepository(),
    metricSeries: new NullSessionMetricSeriesRepository(),
    sessionEvents: new NullCodingAgentSessionEventsRepository(),
  });
  // Pull-request linkage against an unconfigured App and null stores: every
  // read answers empty, every write is a no-op, and no test can accidentally
  // reach github.com.
  const testGithub = GithubCompositionAdapter.create({
    database: testPrisma,
    config: { appId: "", privateKey: "" },
    redis: null,
    organization: nullOrganizations,
    project: testProjects,
    codingAgent: testCodingAgentSessions,
  });
  const testPullRequestUsage = new PullRequestUsageService({
    pullRequests: testGithub,
    sessions: new NullCodingAgentSessionRepository(),
    personalSessions: testCodingAgentSessions,
    sessionEvents: new NullCodingAgentSessionEventsRepository(),
    installations: testGithub,
    resolveOrganizationId: async () => undefined,
    // No enterprise policy in the test app: everything reads as billed, the
    // conservative answer for a cost.
    isSourceNonBillable: async () => false,
  });
  const testCodingAgentSessionsList = new CodingAgentSessionsListService({
    sessions: testCodingAgentSessions,
    pullRequests: testGithub,
    resolveOrganizationId: async () => undefined,
  });
  const testDataset = AppDatasetRuntime.create({
    database: testPrisma,
  }).build();
  const testWorkflows = AppWorkflowRuntime.create({
    database: testPrisma,
    datasets: testDataset,
  }).build();
  const agents = AgentsFeature.create({
    prisma: testPrisma,
    session: null,
    workflows: testWorkflows,
  });
  const testEvaluators = EvaluatorFeature.create({
    prisma: testPrisma,
    workflows: testWorkflows,
  });
  const testEvaluationService = AppEvaluationRuntime.create({
    resolveClickHouse: async () => ({
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    }),
    retentionFloor: createRetentionFloorService(testRetentionPolicyCache),
    execution: AppEvaluationExecutionPort.create(async () => ({
      status: "skipped",
    })),
    workflows: testWorkflows,
  }).build();
  const testMonitors = PostgresMonitorAdapter.create({
    database: testPrisma,
    evaluators: testEvaluators,
    generateId: () => "monitor_test",
  });
  const testScenarios = AppScenarioRuntime.create({
    database: testPrisma,
    generateId: () => generate(KSUID_RESOURCES.SCENARIO).toString(),
  }).build();
  const testSuiteRuns = SuiteRunService.create({
    resolveClickHouseClient: null,
    startSuiteRun: noop,
    queueSimulationRun: noop,
  });
  const testSuites = AppSuiteRuntime.create({
    database: testPrisma,
    agents,
    prompts,
    scenarios: testScenarios,
    execution: AppSuiteExecutionPort.create({ suiteRuns: testSuiteRuns }),
    generateId: () => `suite_${nanoid()}`,
  }).build();
  const testSimulations = AppSimulationRuntime.create({
    clickhouseEnabled: false,
    resolveClient: async () => {
      throw new Error("ClickHouse is not available in the test app");
    },
    commands: testSimulationCommands,
  }).build();
  const testLangWatchQL = new LangWatchQLService({
    executor: null,
    database: DEFAULT_LWQL_DATABASE,
  });
  const testTopics = AppTopicRuntime.create({
    database: testPrisma,
    processStore: new PrismaProcessStore(testPrisma),
  }).build();

  return new App({
    config,
    agents,
    dataset: testDataset,
    workflows: testWorkflows,
    evaluators: testEvaluators,
    monitors: testMonitors,
    apiKeys,
    managedProviders,
    modelProviders,
    prompts,
    broadcast: testBroadcast,
    presence: AppPresenceRuntime.create({
      redis: null,
      broadcast: testBroadcast,
      projects: testProjects,
    }),
    secrets: AppSecretRuntime.create({ database: testPrisma }),
    traces: (() => {
      return {
        summary: traced(
          new TraceSummaryService(new NullTraceSummaryRepository()),
          "TraceSummaryService",
        ),
        list: traced(
          new TraceListService(
            new NullTraceListRepository(),
            testEvaluationService,
            testTopics,
          ),
          "TraceListService",
        ),
        sessionGroups: traced(
          new SessionGroupsService({
            repository: new NullSessionGroupsRepository(),
            codingAgentSessions: testCodingAgentSessions,
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
            canonical: new NullCanonicalLogRecordRepository(),
          }),
          "LogRecordStorageService",
        ),
        collection: traced(
          new TraceRequestCollectionService({
            dedup: createSpanDedupeService(null),
            recordSpan: noop,
          }),
          "TraceRequestCollectionService",
        ),
        logCollection: traced(
          new LogRequestCollectionService({
            recordLogRecords: noop,
            recordLogContributions: noop,
          }),
          "LogRequestCollectionService",
        ),
        metricCollection: traced(
          new MetricRequestCollectionService({
            recordDataPoints: noop,
            recordMetricCorrelations: noop,
          }),
          "MetricRequestCollectionService",
        ),
        editOverlay: TraceEditOverlayService.create(testPrisma),
      };
    })(),
    evaluations: testEvaluationService,
    analytics: AnalyticsAdapter.create({
      resolveClient: async () => {
        throw new Error("ClickHouse not available in test app");
      },
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
      runHistoryTelemetry: AppExperimentRunHistoryTelemetry.create(),
      dspyRetention:
        AppExperimentDspyRetentionPort.create(testRetentionPolicyCache),
      slugify,
      newId: () => nanoid(8),
    }).build(),
    scenarios: testScenarios,
    suites: testSuites,
    automation: AppAutomationRuntime.create({
      database: testPrisma,
      redis: null,
    }).build(),
    triggerTemplates: (() => {
      const testDeps = {
        baseHost: config.baseHost ?? env.BASE_HOST,
        notifier: {
          sendEmail: async () => {
            /* test no-op */
          },
          sendSlack: async () => {
            /* test no-op */
          },
          sendSlackBot: async () => {
            /* test no-op */
          },
          sendWebhook: async () => ({ status: 200 }),
        },
      };
      return {
        testFire: (input: Parameters<typeof testFireTrigger>[1]) =>
          testFireTrigger(testDeps, input),
      };
    })(),
    simulations: testSimulations,
    simulationExports: ScenarioRunExportService.create(testSimulations),
    suiteRuns: {
      runs: testSuiteRuns,
    },
    topics: testTopics,
    gateway: {
      budgetOverview: testGovernanceRuntime.budgetOverview,
      budgetDecisions: GatewayBudgetService.create(testPrisma),
      budgets: undefined,
      virtualKeySpend: undefined,
      spendEvents: undefined,
      webhookEvents: undefined,
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
    usageStats: {
      instance: new InstanceUsageStatsClickHouseRepository(async () => {
        throw new Error("ClickHouse is not available in the test app");
      }),
    },
    governance: {
      activity: testGovernanceActivity,
      ingestionTemplates: testGovernanceRuntime.ingestionTemplates,
      ingestionSources: testIngestionSources,
      setupState: testGovernanceRuntime.setupState,
      ocsfExport: testGovernanceRuntime.ocsfExport,
      ottlGateway: testGovernanceRuntime.ottlGateway,
      policy: testGovernanceRuntime.policy,
      canonicalCostExtractor: testGovernanceRuntime.canonicalCostExtractor,
      ocsfEvents: undefined,
      traceActivity: undefined,
      kpis: undefined,
      personalUsage: testGovernanceRuntime.personalUsage,
      routingPolicies: testGovernanceRuntime.routingPolicies,
      personalVirtualKeys: testGovernanceRuntime.personalVirtualKeys,
      aiTools: testGovernanceRuntime.aiTools,
      cliBootstrap: testGovernanceRuntime.cliBootstrap,
      cliSessions: testGovernanceRuntime.cliSessions,
      cliTokenRevocation: testGovernanceRuntime.cliTokenRevocation,
      adminWorkspaceViewAudit:
        testGovernanceRuntime.adminWorkspaceViewAudit,
      quarantineFill: testGovernanceRuntime.quarantineFill,
      ingestionKeys: testGovernanceRuntime.ingestionKeys,
    },
    billableEvents: undefined,
    billingQueries: BillableEventsQueryService.create(null),
    codingAgents: {
      sessions: testCodingAgentSessions,
      sessionsList: testCodingAgentSessionsList,
      pullRequestUsage: testPullRequestUsage,
    },
    github: testGithub,
    storedObjects: {
      crossTenantOwnerLookup: new StoredObjectOwnerClickHouseRepository(
        async () => [],
      ),
    },
    opsExplain: {
      service: new OpsExplainService(
        new OpsExplainClickHouseRepository({ fallbackClient: () => null }),
      ),
    },
    langy: AppLangyRuntime.create({ database: testPrisma }).build({
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
      turns: (ports) =>
        LangyTurnService.create({
          conversations: ports.conversations,
          credentials: ports.credentials,
          prompts,
          resolveModel: async () => {
            throw new Error("no model provider in test app");
          },
          worker: null,
          tokenBuffer: null,
          reservePermit: async () => ({
            reserved: false,
            allowed: false,
            resetAt: 0,
          }),
          releasePermit: noop,
          perDayPrCap: 0,
          mintSessionKey: async () => {
            throw new Error("no session-key mint in test app");
          },
          revokeSessionKey: noop,
          admission: ports.admission,
          accessStore: null,
          handoffStore: null,
          messages: ports.messages,
        }),
      credentials: createAppLangyCredentialComposition({
        prisma: testPrisma,
        github: () => testGithub,
        workerCallbackUrl:
          env.LANGY_WORKER_CALLBACK_URL ??
          env.LANGWATCH_ENDPOINT ??
          env.LANGWATCH_API_URL,
        workerGatewayBaseUrl:
          env.LANGY_WORKER_GATEWAY_URL ??
          env.LW_GATEWAY_PUBLIC_URL ??
          env.LW_GATEWAY_BASE_URL,
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
    tokenizer: new TokenizerService(new NullTokenizerClient()),
    usage: new UsageService(
      nullOrganizations,
      TraceUsageService.create(),
      new EventUsageService(),
      async () => FREE_PLAN,
      null,
    ),
    planProvider: PlanProviderService.create({
      getActivePlan: async () => FREE_PLAN,
    }),
    subscription: undefined,
    billingCustomer: undefined,
    notifications: NotificationService.createNull(),
    nurturing: undefined,
    usageLimits: UsageLimitService.createNull(),
    ops: {
      queues: new QueueService({ repo: new NullQueueRepository() }),
      scheduler: new SchedulerOpsService({
        repo: new NullScheduledJobStore(),
      }),
      eventExplorer: new EventExplorerService(
        new NullEventExplorerRepository(),
      ),
      managerExplorer: new ManagerExplorerService({
        store: new InMemoryProcessStore(),
        fleet: new NullProcessOpsRepository(),
        audit: new NullProcessAuditSink(),
      }),
      replay: new ReplayService(new NullReplayRepository()),
      blobStore: new BlobStoreService(new NullBlobStoreRepository()),
      metricsCollector: null,
      snapshotReader: null,
    },
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
      ...AppGovernanceEventingAdapter.noopCommands(),
      billing: {
        reportUsageForMonth: noop,
      } as AppCommands["billing"],
      automations: {
        recordTriggerMatch: noop,
      } as AppCommands["automations"],
      scenarioExecutionPool: {
        get: () => null,
        set: () => {
          /* noop */
        },
      },
    },
    retentionPolicyCache: testRetentionPolicyCache,
    dataRetention: {
      policy: new DataRetentionPolicyService(
        testRetentionPolicyRepo,
        testRetentionPolicyCache,
      ),
      pinning: testPinnedTraceService,
      retroactive: new RetroactiveUpdateService(null),
      metering: new StorageMeterService({ resolveClickHouseClient: null }),
    },
    share: new ShareService(
      // The same repository the real preset wires, so a test organization
      // that has been cut over exercises the ledger path rather than a shape
      // only tests see. The writer is built over `testPrisma` explicitly
      // through the same contract capability as production.
      new LedgerShareRepository({
        legacy: new PrismaShareRepository(testPrisma),
        prisma: testPrisma,
        writer: () => testAuthz.grants,
        authz: testAuthz.permissions,
      }),
      testPinnedTraceService,
      {
        isTraceSharingEnabled: async (projectId) => {
          // Effective sharing = org AND project (ADR-057).
          const project = await testPrisma.project.findUnique({
            where: { id: projectId },
            select: {
              traceSharingEnabled: true,
              team: {
                select: {
                  organization: { select: { traceSharingEnabled: true } },
                },
              },
            },
          });
          return (
            !!project &&
            project.team.organization.traceSharingEnabled &&
            project.traceSharingEnabled
          );
        },
      },
    ),
    // No Redis in the test preset: every open counts as a viewing and nothing
    // is cached, which is the stricter behaviour of both.
    sharedTraceCache: createSharedTracePayloadCache(null),
    _authzMigration: testAuthz.migration,
    ...overrides,
  });
}
