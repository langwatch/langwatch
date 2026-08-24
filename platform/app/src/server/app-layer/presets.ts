import type { ClickHouseClient } from "@clickhouse/client";
import { BillableEventsClickHouseRepository } from "@ee/billing/services/billableEvents.clickhouse.repository";
import { createNoopEnterprisePipelineCommands } from "@ee/event-sourcing/pipelineSet";
import { resolveSourceNonBillable } from "@ee/governance/services/costAttributionPolicy.service";
import { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { GovernanceTraceActivityClickHouseRepository } from "@ee/governance/services/governanceTraceActivity.clickhouse.repository";
import { PersonalUsageClickHouseRepository } from "@ee/governance/services/personalUsage.clickhouse.repository";
import { WebhookEndpointService } from "@ee/webhooks/webhookEndpoint.service";
import { WebhookEventsClickHouseRepository } from "@ee/webhooks/webhookEvents.clickhouse.repository";
import { createLogger } from "@langwatch/observability";
import { RedisConnectionService } from "@langwatch/redis-client";
import { env } from "~/env.mjs";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import { ClickHouseAnalyticsService } from "~/server/analytics/clickhouse/clickhouse-analytics.service";
import {
  LwqlKeyMapClickHouseRepository,
  NullLwqlKeyMapRepository,
} from "~/server/analytics/lwql/lwqlKeyMap.repository";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import { liveTriggerNotifier } from "~/server/app-layer/automations/delivery/triggerNotifier";
import { LangyCredentialService } from "~/server/app-layer/langy/LangyCredentialService";
import { LangyFeedbackPromptService } from "~/server/app-layer/langy/langy-feedback-prompt.service";
import {
  mintLangySessionApiKey,
  revokeLangySessionApiKey,
} from "~/server/app-layer/langy/langyApiKey";
import { resolveLangyHarness } from "~/server/app-layer/langy/langyHarness";
import { createLangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import { createLangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { createLangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import { createLangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
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
import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import { bindProcessFleetMetricsSource } from "~/server/event-sourcing/process-manager/metrics";
import { BillableEventsMeterClickHouseRepository } from "~/server/event-sourcing/projections/global/repositories/billable-events.clickhouse.repository";
import { getFeatureFlagStore } from "~/server/featureFlag/featureFlagStore.postgres";
import { FilterService } from "~/server/filters/filter.service";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
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
import { PromptService } from "~/server/prompt-config/prompt.service";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { StoredObjectOwnerClickHouseRepository } from "~/server/stored-objects/repositories/stored-object-owner.clickhouse.repository";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { getSaaSPlanProvider } from "../../../ee/billing";
import { NotificationService } from "../../../ee/billing/notifications/notification.service";
import { NotificationRepository } from "../../../ee/billing/notifications/repositories/notification.repository";
import { UsageLimitService } from "../../../ee/billing/notifications/usage-limit.service";
import { NurturingService } from "../../../ee/billing/nurturing/nurturing.service";
import { handleLicensePurchase } from "../../../ee/billing/services/licensePurchaseHandler";
import { createSeatEventSubscriptionFns } from "../../../ee/billing/services/seatEventSubscription";
import { EESubscriptionService } from "../../../ee/billing/services/subscription.service";
import * as subscriptionItemCalculator from "../../../ee/billing/services/subscriptionItemCalculator";
import { StripeUsageReportingService } from "../../../ee/billing/services/usageReportingService";
import {
  EEWebhookService,
  type WebhookService,
} from "../../../ee/billing/services/webhookService";
import { createStripeClient } from "../../../ee/billing/stripe/stripeClient";
import { meters } from "../../../ee/billing/stripe/stripePriceCatalog";
import { FREE_PLAN } from "../../../ee/licensing/constants";
import { StorageMeterService } from "../data-retention/metering/storageMeter.service";
import { PinnedTraceRepository } from "../data-retention/pinning/pinnedTrace.repository";
import { PinnedTraceService } from "../data-retention/pinning/pinnedTrace.service";
import { DataRetentionPolicyRepository } from "../data-retention/policy/dataRetentionPolicy.repository";
import { DataRetentionPolicyService } from "../data-retention/policy/dataRetentionPolicy.service";
import { RetentionPolicyCache } from "../data-retention/retentionPolicyCache";
import { RetroactiveUpdateService } from "../data-retention/retroactive/retroactiveUpdate.service";
import { EventSourcing } from "../event-sourcing";
import { Deferred } from "../event-sourcing/deferred";
import type { PipelineRepositories } from "../event-sourcing/pipelineRegistry";
import {
  type AppCommands,
  PipelineRegistry,
  type ScenarioExecutionPoolHolder,
} from "../event-sourcing/pipelineRegistry";
import { buildAutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.wiring";
import { createExperimentRunItemAppendStore } from "../event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import {
  ExperimentIdLookupClickHouseRepository,
  ExperimentRunStateRepositoryClickHouse,
  ExperimentRunStateRepositoryMemory,
  NullExperimentIdLookupRepository,
} from "../event-sourcing/pipelines/experiment-run-processing/repositories";
import { LangyAnalyticsEventAppendStore } from "../event-sourcing/pipelines/langy-conversation-processing/projections/langyAnalyticsEvent.store";
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
import {
  InMemoryProcessStore,
  PrismaProcessStore,
} from "../event-sourcing/process-manager";
import { ExperimentService } from "../experiments/experiment.service";
import { ScenarioRunExportService } from "../export/scenario-runs/scenario-run-export.service";
import { InviteService } from "../invites/invite.service";
import { resolveOrganizationId } from "../organizations/resolveOrganizationId";
import { OrganizationRepository } from "../repositories/organization.repository";
import { getLicenseHandler } from "../subscriptionHandler";
import { TraceEditOverlayService } from "../traces/edit-overlay/traceEditOverlay.service";
import { EventUsageService } from "../traces/event-usage.service";
import { TraceService } from "../traces/trace.service";
import { TraceUsageService } from "../traces/trace-usage.service";
import { runEvaluationWorkflow } from "../workflows/runWorkflow";
import { createAnalyticsService } from "./analytics";
import { LegacyAnalyticsBackendClickHouseRepository } from "./analytics/repositories/legacy-analytics-backend.clickhouse.repository";
import { App, getApp, globalForApp, initializeApp } from "./app";
import { installAuthzEngineGateReporting } from "./authz/engine-gate-reporting";
import { GrantsLedgerWriter, grantsLedgerWriter } from "./authz/ledger";
import { PrismaAuthzAuditTrailRepository } from "./authz/repositories/authz-audit-trail.prisma.repository";
import { PrismaAuthzGrantsWriteRepository } from "./authz/repositories/authz-grants-write.prisma.repository";
import { EmailSuppressionService } from "./automations/emailSuppression.service";
import { REPORT_SCHEDULER_TARGET_TYPE } from "./automations/report.builder";
import {
  PrismaEmailSuppressionNameLookupRepository,
  PrismaEmailSuppressionRepository,
} from "./automations/repositories/emailSuppression.prisma.repository";
import {
  NullEmailSuppressionNameLookupRepository,
  NullEmailSuppressionRepository,
} from "./automations/repositories/emailSuppression.repository";
import { PrismaTriggerRepository } from "./automations/repositories/trigger.prisma.repository";
import { NullTriggerRepository } from "./automations/repositories/trigger.repository";
import { TriggerService } from "./automations/trigger.service";
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
import { DspyStepService } from "./dspy-steps/dspy-step.service";
import { DspyStepClickHouseRepository } from "./dspy-steps/repositories/dspy-step.clickhouse.repository";
import { NullDspyStepRepository } from "./dspy-steps/repositories/dspy-step.repository";
import { PrismaEvaluationCostRecorder } from "./evaluations/evaluation-cost.recorder";
import { createDefaultModelEnvResolver } from "./evaluations/evaluation-execution.factories";
import { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import { EvaluationRunService } from "./evaluations/evaluation-run.service";
import { MonitorPerformanceService } from "./evaluations/monitor-performance.service";
import { EvaluationAnalyticsClickHouseRepository } from "./evaluations/repositories/evaluation-analytics.clickhouse.repository";
import { NullEvaluationAnalyticsRepository } from "./evaluations/repositories/evaluation-analytics.repository";
import { EvaluationAnalyticsRollupClickHouseRepository } from "./evaluations/repositories/evaluation-analytics-rollup.clickhouse.repository";
import { NullEvaluationAnalyticsRollupRepository } from "./evaluations/repositories/evaluation-analytics-rollup.repository";
import { EvaluationRunClickHouseRepository } from "./evaluations/repositories/evaluation-run.clickhouse.repository";
import { NullEvaluationRunRepository } from "./evaluations/repositories/evaluation-run.repository";
import { MonitorPerformanceClickHouseRepository } from "./evaluations/repositories/monitor-performance.clickhouse.repository";
import { NullMonitorPerformanceRepository } from "./evaluations/repositories/monitor-performance.repository";
import { TraceEvaluationsClickHouseRepository } from "./evaluations/repositories/trace-evaluations.clickhouse.repository";
import { FilterOptionsClickHouseRepository } from "./filters/repositories/filter-options.clickhouse.repository";
import {
  runBranchRecheckPass,
  runBranchRetentionPrune,
} from "./github/github-branch-recheck.worker";
import { GithubInstallationsService } from "./github/github-installations.service";
import { GithubPullRequestMappingService } from "./github/github-pull-request-mapping.service";
import { GithubPullRequestStatusService } from "./github/github-pull-request-status.service";
import { getGithubAppConfig } from "./github/githubAppConfig";
import { GithubAppTokenService, type RedisLike } from "./github/githubAppToken";
import { PrismaGithubInstallationsRepository } from "./github/repositories/github-installations.prisma.repository";
import { NullGithubInstallationsRepository } from "./github/repositories/github-installations.repository";
import { PrismaGithubPullRequestsRepository } from "./github/repositories/github-pull-requests.prisma.repository";
import { NullGithubPullRequestsRepository } from "./github/repositories/github-pull-requests.repository";
import { LocalDoorBreakGlassBinding } from "./identity/break-glass-binding";
import {
  EmailJoinRequestNotifier,
  JoinRequestLifecycleDispatcher,
} from "./identity/join-request-adapters";
import { AdminEmailPlatformOperators } from "./identity/platform-operators";
import { PrismaIdentityHeadsRepository } from "./identity/repositories/identity-heads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./identity/repositories/identity-projection.prisma.repository";
import { PrismaJoinRequestReadRepository } from "./identity/repositories/join-request.prisma.repository";
import { PrismaJoinRequestProjectionRepository } from "./identity/repositories/join-request-projection.prisma.repository";
import { PrismaMfaEnrollmentRepository } from "./identity/repositories/mfa-enrollment.prisma.repository";
import { PrismaMfaEnrollmentProjectionRepository } from "./identity/repositories/mfa-enrollment-projection.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "./identity/repositories/sso-connection-projection.prisma.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "./identity/repositories/sso-connection-reads.prisma.repository";
import { SsoConnectionTeardownDispatcher } from "./identity/sso-connection-teardown";
import { LangyConversationService } from "./langy/langy-conversation.service";
import {
  createLangyTrustedMessageReader,
  LangyMessageService,
} from "./langy/langy-message.service";
import { createLangyConversationTitleGenerator } from "./langy/langy-title-generation.service";
import { LangyTurnService } from "./langy/langy-turn.service";
import { ClickHouseLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.clickhouse.repository";
import { NullLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.repository";
import { PrismaLangyConversationRepository } from "./langy/repositories/langy-conversation.prisma.repository";
import { NullLangyConversationRepository } from "./langy/repositories/langy-conversation.repository";
import { PrismaLangyConversationProjectionRepository } from "./langy/repositories/langy-conversation-projection.prisma.repository";
import { PrismaLangyConversationTurnProjectionRepository } from "./langy/repositories/langy-conversation-turn-projection.prisma.repository";
import { PrismaLangyMessageRepository } from "./langy/repositories/langy-message.prisma.repository";
import { NullLangyMessageRepository } from "./langy/repositories/langy-message.repository";
import { PrismaLangyMessageProjectionRepository } from "./langy/repositories/langy-message-projection.prisma.repository";
import { PrismaLangyTurnAdmissionRepository } from "./langy/repositories/langy-turn-admission.prisma.repository";
import { NullLangyTurnAdmissionRepository } from "./langy/repositories/langy-turn-admission.repository";
import { CanonicalLogRecordClickHouseRepository } from "./logs/repositories/canonical-log-record.clickhouse.repository";
import { NullCanonicalLogRecordRepository } from "./logs/repositories/canonical-log-record.repository";
import { MetricDataPointClickHouseRepository } from "./metrics/repositories/metric-data-point.clickhouse.repository";
import { NullMetricDataPointRepository } from "./metrics/repositories/metric-data-point.repository";
import { MonitorService } from "./monitors/monitor.service";
import { PrismaMonitorRepository } from "./monitors/repositories/monitor.prisma.repository";
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
import { permissionsServiceFor } from "./permissions/runtime";
import { PresenceService } from "./presence/presence.service";
import { InMemoryPresenceRepository } from "./presence/repositories/presence.memory.repository";
import { RedisPresenceRepository } from "./presence/repositories/presence.redis.repository";
import { ProjectService } from "./projects/project.service";
import { PrismaProjectRepository } from "./projects/repositories/project.prisma.repository";
import { NullProjectRepository } from "./projects/repositories/project.repository";
import { loadReportCharts } from "./reports/report-chart.service";
import { dispatchScheduledReport } from "./reports/report-dispatch";
import { toReportTraceRow } from "./reports/trace-report-row";
import {
  NullScheduledJobRepository,
  PrismaScheduledJobRepository,
} from "./scheduler/scheduled-job.repository";
import { schedulerRegistry } from "./scheduler/scheduler.registry";
import { SchedulerService } from "./scheduler/scheduler.service";
import { LedgerShareRepository } from "./share/repositories/share.ledger.repository";
import { PrismaShareRepository } from "./share/repositories/share.prisma.repository";
import { ShareService } from "./share/share.service";
import { createShareViewDedupeService } from "./share/share-view-dedupe.service";
import { createSharedTracePayloadCache } from "./share/shared-trace-cache.service";
import { SimulationRunService } from "./simulations/simulation-run.service";
import { createCompositePlanProvider } from "./subscription/composite-plan-provider";
import { PlanProviderService } from "./subscription/plan-provider";
import { createSelfHostedPlanProvider } from "./subscription/self-hosted-plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import { SuiteRunService } from "./suites/suite-run.service";
import { startSystemMigrations } from "./system-migrations/boot";
import { startTopicClusteringBootSeeds } from "./topic-clustering/bootSeeds";
import { clusterTopicsForProject } from "./topic-clustering/clustering";
import { NullTopicRepository } from "./topic-clustering/repositories/null-topic.repository";
import { PrismaTopicRepository } from "./topic-clustering/repositories/topic.prisma.repository";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-history-projection.prisma.repository";
import { PrismaTopicClusteringRunProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-projection.prisma.repository";
import { PrismaTopicClusteringStatusRepository } from "./topic-clustering/repositories/topic-clustering-status.repository";
import { PrismaTopicModelProjectionRepository } from "./topic-clustering/repositories/topic-model-projection.prisma.repository";
import { TopicService } from "./topic-clustering/topic.service";
import { TopicClusteringStatusService } from "./topic-clustering/topic-clustering-status.service";
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
import { NullGithubPullRequestLookup } from "./traces/session-groups.pull-request-link";
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

  installAuthzEngineGateReporting();

  const prisma = globalPrisma;
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

  // Clustering reads ClickHouse directly (its query has no repository yet), so
  // it takes the resolver as a parameter. Bound once here, then handed to both
  // the event-sourcing run port and the App, so no caller re-derives one.
  const runClusteringPage: AppDependencies["topicClustering"]["runPage"] = (
    params,
  ) => clusterTopicsForProject({ ...params, resolveClickHouseClient });

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

  const broadcast = new BroadcastService(redis);
  const projects = traced(
    new ProjectService(
      new PrismaProjectRepository(prisma),
      new LwqlKeyMapClickHouseRepository(resolveClickHouseClient),
    ),
    "ProjectService",
  );
  const presence = new PresenceService(
    redis
      ? new RedisPresenceRepository(redis)
      : new InMemoryPresenceRepository(),
    broadcast,
    projects,
  );
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
  const evaluationRuns = traced(
    new EvaluationRunService(
      clickhouseEnabled
        ? new EvaluationRunClickHouseRepository({
            resolveClient: resolveClickHouseClient,
            retentionResolver: retentionPolicyCache,
          })
        : new NullEvaluationRunRepository(),
    ),
    "EvaluationRunService",
  );
  const topics = traced(
    new TopicService(new PrismaTopicRepository(prisma)),
    "TopicService",
  );
  const traceList = traced(
    new TraceListService(
      clickhouseEnabled
        ? new TraceListClickHouseRepository(resolveClickHouseClient)
        : new NullTraceListRepository(),
      evaluationRuns,
      topics,
    ),
    "TraceListService",
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
    ExperimentService.create({ prisma, broadcaster: broadcast }),
    "ExperimentService",
  );
  const organizations = traced(
    new OrganizationService(
      new PrismaOrganizationRepository(prisma),
      new PromptTagRepository(prisma),
    ),
    "OrganizationService",
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
      workflowExecutor: { runEvaluationWorkflow },
    }),
    "EvaluationExecutionService",
  );

  const dspySteps = traced(
    new DspyStepService(
      clickhouseEnabled
        ? new DspyStepClickHouseRepository(
            resolveClickHouseClient,
            retentionPolicyCache,
          )
        : new NullDspyStepRepository(),
    ),
    "DspyStepService",
  );
  // The ADR-034 analytics read API, built once here (same
  // shape `createAnalyticsService` always used — unconditional on
  // `clickhouseEnabled`, since the resolver itself already throws at query
  // time when ClickHouse isn't configured) and handed out as
  // `getApp().analytics.service` instead of each of its ~6 callers
  // constructing — and each resolving a ClickHouse client — its own.
  const analyticsService = createAnalyticsService({
    resolveClient: resolveClickHouseClient,
    legacyBackend: new ClickHouseAnalyticsService(
      new LegacyAnalyticsBackendClickHouseRepository(resolveClickHouseClient),
    ),
  });
  const simulationReads = SimulationRunService.create(
    clickhouseEnabled ? resolveClickHouseClient : null,
  );
  // Shares the repository instance so the export reads through the same store
  // the run history does, rather than opening a second one.
  const scenarioRunExport = ScenarioRunExportService.create(
    simulationReads.repository,
  );
  // SuiteRunService is created after pipeline registration (needs startSuiteRun command)

  const evaluations = {
    runs: evaluationRuns,
    execution: evaluationExecution,
    performance: traced(
      new MonitorPerformanceService(
        clickhouseEnabled
          ? new MonitorPerformanceClickHouseRepository(resolveClickHouseClient)
          : new NullMonitorPerformanceRepository(),
      ),
      "MonitorPerformanceService",
    ),
    // Unconditional on `clickhouseEnabled` for the same reason the analytics
    // service is: the resolver throws at query time when ClickHouse isn't
    // configured, and this repository already degrades that to an empty read.
    traceEvaluations: new TraceEvaluationsClickHouseRepository(
      resolveClickHouseClient,
    ),
  };

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

  const planProvider = config.isSaas
    ? PlanProviderService.create(
        createCompositePlanProvider({
          saasPlanProvider: {
            getActivePlan: ({ organizationId, user }) =>
              getSaaSPlanProvider().getActivePlan(organizationId, user),
          },
          licensePlanProvider: {
            getActivePlan: ({ organizationId }) =>
              getLicenseHandler().getActivePlan(organizationId),
          },
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
  let usageReportingService: StripeUsageReportingService | undefined;
  let webhookService: WebhookService | undefined;
  let stripeClient: ReturnType<typeof createStripeClient> | undefined;
  if (config.isSaas) {
    stripeClient = createStripeClient();
    usageReportingService = new StripeUsageReportingService({
      stripe: stripeClient,
      meterId: meters.BILLABLE_EVENTS,
    });
    const seatEventFns = createSeatEventSubscriptionFns({
      stripe: stripeClient,
      db: prisma,
    });
    subscription = EESubscriptionService.create({
      stripe: stripeClient,
      db: prisma,
      itemCalculator: subscriptionItemCalculator,
      seatEventFns,
    });
    webhookService = EEWebhookService.create({
      db: prisma,
      stripe: stripeClient,
      itemCalculator: subscriptionItemCalculator,
      // Pass planProvider explicitly — InviteService.create defaults to
      // getApp().planProvider, but we're still inside initializeDefaultApp
      // so the App singleton isn't available yet.
      inviteApprover: InviteService.create(prisma, { planProvider }),
      licensePurchaseHandler: { handle: handleLicensePurchase },
      licensePaymentLinkId: env.STRIPE_LICENSE_PAYMENT_LINK_ID,
      licensePrivateKey: env.LANGWATCH_LICENSE_PRIVATE_KEY,
      getPostHog: () => getPostHogInstance(),
    });
  }

  const monitors = traced(
    new MonitorService(new PrismaMonitorRepository(prisma)),
    "MonitorService",
  );
  const triggers = new TriggerService(
    new PrismaTriggerRepository(prisma),
    new PrismaScheduledJobRepository(prisma),
    redis,
  );
  const emailSuppressions = new EmailSuppressionService(
    new PrismaEmailSuppressionRepository(prisma),
    new PrismaEmailSuppressionNameLookupRepository(prisma),
  );
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

  const nurturing = config.customerIoApiKey
    ? NurturingService.create({
        config: {
          customerIoApiKey: config.customerIoApiKey,
          customerIoRegion: config.customerIoRegion,
        },
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
    writer: () => grantsLedgerWriter(),
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
        const config = await projects.getTraceSharingConfig(projectId);
        return !!config && config.orgEnabled && config.projectEnabled;
      },
      // Makes `maxViews` count viewings rather than requests, so a recipient
      // refreshing a single-view link doesn't lock themselves out. ADR-057.
      viewDedupe: createShareViewDedupeService(redis),
    }),
    "ShareService",
  );
  const sharedTraceCache = createSharedTracePayloadCache(redis);

  const langyConversationRepository = new PrismaLangyConversationRepository(
    prisma,
  );
  const langyTurnAdmission = new PrismaLangyTurnAdmissionRepository(prisma);
  const langyMessageRepository = new PrismaLangyMessageRepository(prisma);
  const langyAgentUrl = process.env.OPENCODE_AGENT_URL;
  const langyInternalSecret = process.env.LANGY_INTERNAL_SECRET;
  const langyWorker = createLangyWorkerPort({
    agentUrl: langyAgentUrl ?? "",
    internalSecret: langyInternalSecret ?? "",
  });
  const langyHandoffStore = createLangyTurnHandoffStore({ redis });
  const langyTokenBuffer = createLangyTokenBuffer({ redis });
  const langyTitleGenerator = createLangyConversationTitleGenerator({
    messages: createLangyTrustedMessageReader(langyMessageRepository),
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
    langyConversationState: new PrismaLangyConversationProjectionRepository(
      prisma,
    ),
    langyConversationTurnState:
      new PrismaLangyConversationTurnProjectionRepository(prisma),
    langyMessageStorage: new PrismaLangyMessageProjectionRepository(prisma),
    langyAnalyticsEventStorage: new LangyAnalyticsEventAppendStore(
      clickhouseEnabled
        ? new ClickHouseLangyAnalyticsEventRepository(resolveClickHouseClient)
        : new NullLangyAnalyticsEventRepository(),
    ),
    processStore: new PrismaProcessStore(prisma),
    authzGrantsWrite: new PrismaAuthzGrantsWriteRepository(prisma),
    authzAuditTrail: new PrismaAuthzAuditTrailRepository(prisma),
    identityProjection: new PrismaIdentityProjectionRepository(prisma),
    identityHeads: new PrismaIdentityHeadsRepository(prisma),
    mfaProjection: new PrismaMfaEnrollmentProjectionRepository(prisma),
    mfaEnrollments: new PrismaMfaEnrollmentRepository(prisma),
    ssoConnectionProjection: new PrismaSsoConnectionProjectionRepository(
      prisma,
    ),
    ssoConnectionReads: new PrismaSsoConnectionReadRepository(prisma),
    ssoConnectionStranding: new PrismaSsoConnectionStrandingRepository(prisma),
    ssoBreakGlassBindings: new LocalDoorBreakGlassBinding(),
    ssoPlatformOperators: new AdminEmailPlatformOperators(prisma),
    ssoConnectionTeardown: new SsoConnectionTeardownDispatcher(),
    joinRequestProjection: new PrismaJoinRequestProjectionRepository(prisma),
    joinRequestReads: new PrismaJoinRequestReadRepository(prisma),
    joinRequestLifecycle: new JoinRequestLifecycleDispatcher(
      prisma,
      new EmailJoinRequestNotifier(prisma),
    ),
    topicClusteringRunStatus: new PrismaTopicClusteringRunProjectionRepository(
      prisma,
    ),
    topicClusteringRunHistory:
      new PrismaTopicClusteringRunHistoryProjectionRepository(prisma),
    topicModel: new PrismaTopicModelProjectionRepository(prisma),
    langyTurnAdmission,
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
  const webhookEndpointService = new WebhookEndpointService({ prisma });
  const webhookDelivery = clickhouseEnabled
    ? {
        processStore: repositories.processStore,
        endpoints: webhookEndpointService,
        prisma,
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
    ? new WebhookEventsClickHouseRepository(resolveClickHouseClient)
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

  // Billing-month usage rollups (billable_events + trace_summaries),
  // read by the billing pipeline and the usage-limit services.
  const billableEventsRepository = clickhouseEnabled
    ? new BillableEventsClickHouseRepository(
        resolveClickHouseClient,
        getClickHouseClientForOrganization,
      )
    : undefined;

  const es = new EventSourcing({
    clickhouse: clickhouseEnabled ? resolveClickHouseClient : void 0,
    redis,
    enabled: true,
    isSaas: config.isSaas,
    processRole: config.processRole,
    retentionPolicyResolver: retentionPolicyCache,
    // ADR-052: durable persistence for withProcessManager declarations —
    // the SAME store instance the registry's dependency assembly uses.
    processStore: repositories.processStore,
  });

  // ADR-052: automation dispatch ports for the process-manager runtime the
  // registry composes (triggerSettlement + graphAlertSweep). Built on every
  // role — registration is passive shape; the outbox/wake worker loops
  // start only where roleRunsWorkers() is true.
  const automationPorts = buildAutomationDispatchPorts({
    prisma,
    redis: redis ?? null,
    triggers,
    emailSuppressions,
    projects,
    evaluations: { runs: evaluations.runs },
    traces: { spans: spanStorage },
    traceSummaryRepository: repositories.traceSummaryFold,
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
        repo: new PrismaScheduledJobRepository(prisma),
        registry: schedulerRegistry,
        processRole: config.processRole,
        logger: createLogger("langwatch:app-layer:scheduler"),
        redis,
      })
    : undefined;
  scheduler?.start();

  // ADR-092 stage B: the in-place system migrations. Worker-only and
  // fire-and-forget - one pass per boot, level-triggered, so held and parked
  // organizations retry on the restart cadence with nobody running anything.
  // Redis is handed in rather than read back off the App: this composes the
  // App, so `tryGetApp()` is still null here, and a null handle would make
  // the lease unacquirable and every pass a silent no-op.
  const systemMigrations = roleRunsWorkers(config.processRole)
    ? startSystemMigrations({ redis })
    : undefined;

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
              prisma.trigger.findFirst({
                where: { id: triggerId, projectId },
              }),
            loadProject: (projectId) =>
              prisma.project.findUnique({ where: { id: projectId } }),
            sendEmail: sendRenderedTriggerEmail,
            sendSlack: sendRenderedSlackMessage,
            sendSlackBot: postSlackChatMessage,
            filterSuppressedRecipients: ({ projectId, triggerId, emails }) =>
              emailSuppressions.filterSuppressed({
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
              await prisma.triggerSent.create({
                data: {
                  projectId,
                  triggerId,
                  traceId: null,
                  customGraphId: null,
                  createdAt: firedAt,
                  resolvedAt: firedAt,
                },
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
    void triggers
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
    GithubPullRequestMappingService["requestBranchMapping"]
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
      prisma,
      runsWorkers: roleRunsWorkers(config.processRole),
      // Pulled provider cost shares the gateway debits' ClickHouse gate: it
      // lands in the same ledger table, so without ClickHouse there is nowhere
      // for it to go. The pipeline still records every observation on the log.
      pulledUsageLedger: clickhouseEnabled
        ? {
            budgetCHRepository: new GatewayBudgetClickHouseRepository(
              resolveClickHouseClient,
            ),
          }
        : undefined,
    },
    projects,
    monitors,
    triggers,
    prisma,
    organizations,
    traces: { summary: traceSummary, spans: spanStorage },
    evaluations: { runs: evaluations.runs, execution: evaluations.execution },
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
  (globalForApp as any).__scenarioExecutionPool =
    commands.scenarioExecutionPool;

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

  // Langy operational reads come from the Postgres projections; writes remain
  // commands against the canonical ClickHouse event log. The event READER feeds
  // only the tail read (conversationEventsAfter, ADR-059) — null when event
  // sourcing is disabled, in which case the tail is honestly empty.
  const langyConversations = LangyConversationService.create(
    commands.langy,
    langyConversationRepository,
    langyMessageRepository,
    es.getEventStore<LangyConversationProcessingEvent>() ?? null,
  );
  const langyMessages = new LangyMessageService(
    langyMessageRepository,
    langyConversationRepository,
  );

  // The organization's GitHub connection: the install/webhook lifecycle, and
  // the token mints Langy (write) and pull-request linkage (read) ask for. The
  // App is optional per instance; when the private key is unset the service
  // reports `configured=false` and every read short-circuits to "GitHub
  // unavailable" without touching GitHub. The App private key is the only
  // credential and it lives here in the control plane, never near a worker.
  const githubAppConfig = getGithubAppConfig();
  const githubAppTokens = new GithubAppTokenService(
    githubAppConfig.appId,
    githubAppConfig.privateKey,
    // ioredis Redis/Cluster satisfy the narrow RedisLike surface at runtime; the
    // client's overloaded `set` signature just isn't structurally assignable.
    (redis ?? null) as unknown as RedisLike | null,
  );
  // Set once the mapping service exists, below. The installation hook and the
  // service form a cycle (the hook backfills through the service, the service
  // resolves installations through the connection), and this is where it is
  // broken: the hook only ever runs long after composition.
  let githubPullRequestMapping: GithubPullRequestMappingService | null = null;
  const githubInstallations = new GithubInstallationsService(
    new PrismaGithubInstallationsRepository(prisma),
    githubAppTokens,
    // Connecting GitHub is the moment a whole history of folded sessions
    // becomes mappable. Without this the organization would see nothing until
    // someone ran a new session on each branch.
    ({ organizationId }) =>
      githubPullRequestMapping?.runBackfillForOrganization({ organizationId }),
  );

  // Langy turn-start orchestration (ADR-046): the pipeline the
  // Hono route used to inline, now an app-layer service with injected ports. The
  // worker port + turn stores are null when their infra is absent (no agent env /
  // no Redis); the service raises LangyAgentUnavailableError in that case, exactly
  // as the route 503'd.
  const langyTurns = LangyTurnService.create({
    conversations: langyConversations,
    credentials: LangyCredentialService.create(prisma),
    // ADR-050 versioned prompts. Only consulted when LANGY_PROMPT_PROJECT_ID
    // names the project holding the rows; unset (the default) skips the
    // registry entirely and the in-repo text is used verbatim.
    prompts: new PromptService(prisma),
    // Langy resolves through its own feature key (falling back to the
    // original prompt.create_default gate inside the resolver), so a codex
    // default set for Langy never leaks into new-prompt creation. The
    // handle's modelId (the full provider-prefixed id) is what the turn
    // service forwards to the worker (ADR-065).
    resolveModel: ({ projectId }) =>
      getVercelAIModel({ projectId, featureKey: LANGY_CHAT_FEATURE_KEY }),
    worker: langyAgentUrl && langyInternalSecret ? langyWorker : null,
    // The durable buffer backs a user Stop: reconstruct the partial answer and
    // end the live stream (ADR-078). Null without Redis, like the stores below.
    tokenBuffer: redis ? langyTokenBuffer : null,
    reservePermit: reserveLangyGithubPrPermit,
    releasePermit: releaseLangyGithubPrPermit,
    // Check-only cap view for the panel-open warm: signature parity with the
    // turn's token strip, without spending a PR permit on a panel open.
    checkPermit: getLangyGithubPrUsage,
    // The harness flag (`release_langy_pi_harness`), evaluated once per turn
    // and riding `credentials.harness` into probe, stash and dispatch.
    resolveHarness: resolveLangyHarness,
    perDayPrCap: LANGY_GITHUB_PRS_PER_DAY,
    mintSessionKey: ({ session, projectId, organizationId }) =>
      mintLangySessionApiKey({ prisma, session, projectId, organizationId }),
    revokeSessionKey: ({ apiKeyId, projectId }) =>
      revokeLangySessionApiKey({ prisma, apiKeyId, projectId }).then(
        () => undefined,
      ),
    admission: langyTurnAdmission,
    accessStore: redis ? createLangyTurnAccessStore({ redis }) : null,
    handoffStore: redis ? langyHandoffStore : null,
    // A follow-up turn is told what earlier turns of the same conversation
    // created — the agent's own worker forgets it whenever it is reaped or
    // respawned (see `langyConversationMemory`).
    messages: langyMessageRepository,
  });

  const suiteRunService = SuiteRunService.create({
    resolveClickHouseClient: clickhouseEnabled ? resolveClickHouseClient : null,
    startSuiteRun: commands.suiteRuns.startSuiteRun,
    queueSimulationRun: commands.simulations.queueRun,
  });

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

  // Pull-request linkage. The mapping service is the write side (branch to
  // pull requests, negative-cached), the status service the live read, and the
  // usage service the organization-first rollup the Pull Requests page and the
  // REST endpoint share.
  const githubPullRequestsRepository = new PrismaGithubPullRequestsRepository(
    prisma,
  );
  githubPullRequestMapping = new GithubPullRequestMappingService({
    repository: githubPullRequestsRepository,
    installations: githubInstallations,
    appTokens: githubAppTokens,
    resolveOrganizationId,
    findProjectIds: async (organizationId) =>
      (
        await prisma.project.findMany({
          where: { team: { organizationId }, archivedAt: null },
          select: { id: true },
        })
      ).map((project) => project.id),
    sessions: codingAgentSessions,
    touchCodingAgentPullRequestSeen: (params) =>
      projects.touchCodingAgentPullRequestSeen(params),
  });
  requestBranchMapping.resolve((params) =>
    githubPullRequestMapping!.requestBranchMapping(params),
  );
  recheckDueBranches.resolve(() =>
    runBranchRecheckPass({
      repository: githubPullRequestsRepository,
      mapping: githubPullRequestMapping!,
    }),
  );
  pruneStaleBranchLinkage.resolve(() =>
    runBranchRetentionPrune({ repository: githubPullRequestsRepository }),
  );

  const githubPullRequestStatus = new GithubPullRequestStatusService({
    repository: githubPullRequestsRepository,
    installations: githubInstallations,
    appTokens: githubAppTokens,
    redis: (redis ?? null) as unknown as RedisLike | null,
  });

  const pullRequestUsage = new PullRequestUsageService({
    pullRequests: githubPullRequestsRepository,
    sessions: repositories.codingAgentSession,
    personalSessions: codingAgentSessions,
    sessionEvents: repositories.codingAgentSessionEvents,
    installations: githubInstallations,
    resolveOrganizationId,
    // The one place the bundled-plan policy is reached: the service takes the
    // answer as a dep so the read stays free of the enterprise module, and the
    // receiver and this rollup resolve bundled-ness the same way.
    isSourceNonBillable: resolveSourceNonBillable,
  });

  // The Sessions screen's read: the same session service, plus the mapping
  // lookup the sessions lens joins with, so both surfaces answer "which pull
  // request" from one place.
  const codingAgentSessionsList = traced(
    new CodingAgentSessionsListService({
      sessions: codingAgentSessions,
      pullRequests: {
        findForBranches: (args) =>
          githubPullRequestsRepository.findAllByBranchKeys(args),
      },
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
      pullRequests: {
        findForBranches: (args) =>
          githubPullRequestsRepository.findAllByBranchKeys(args),
      },
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
      close: async () => {
        redis.disconnect();
      },
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
  });
  const notificationRepository = new NotificationRepository(prisma);
  const usageLimits = UsageLimitService.create({
    notificationRepository,
    organizationService: organizations,
    usageService: usage,
    notificationService: notifications,
    planProvider,
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
      repo: new PrismaScheduledJobRepository(prisma),
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

  return initializeApp({
    config,
    broadcast,
    presence,
    traces,
    evaluations,
    experiments,
    triggers,
    triggerTemplates,
    emailSuppressions,
    dspySteps: { steps: dspySteps },
    analytics: { service: analyticsService },
    simulations: { runs: simulationReads, export: scenarioRunExport },
    suiteRuns: { runs: suiteRunService },
    topicClustering: {
      status: new TopicClusteringStatusService(
        new PrismaTopicClusteringStatusRepository(prisma),
      ),
      topics,
      runPage: runClusteringPage,
    },
    gateway: {
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
      ocsfEvents: governanceOcsfEventsRepository,
      traceActivity: governanceTraceActivityRepository,
      kpis: governanceKpisRepository,
      personalUsage: personalUsageRepository,
    },
    billableEvents: billableEventsRepository,
    codingAgents: {
      sessions: codingAgentSessions,
      sessionsList: codingAgentSessionsList,
      pullRequestUsage: traced(pullRequestUsage, "PullRequestUsageService"),
    },
    github: {
      installations: traced(githubInstallations, "GithubInstallationsService"),
      pullRequests: {
        mapping: traced(
          githubPullRequestMapping,
          "GithubPullRequestMappingService",
        ),
        status: traced(
          githubPullRequestStatus,
          "GithubPullRequestStatusService",
        ),
        repository: githubPullRequestsRepository,
      },
    },
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
    langy: {
      conversations: traced(langyConversations, "LangyConversationService"),
      turns: traced(langyTurns, "LangyTurnService"),
      messages: traced(langyMessages, "LangyMessageService"),
      credentials: traced(
        LangyCredentialService.create(prisma),
        "LangyCredentialService",
      ),
      feedbackPrompt: traced(
        new LangyFeedbackPromptService({ redis }),
        "LangyFeedbackPromptService",
      ),
    },
    organizations,
    projects,
    permissions: permissionsServiceFor(prisma),
    tokenizer,
    usage,
    planProvider,
    subscription,
    webhookService,
    stripeClient,
    notifications,
    nurturing,
    usageLimits,
    retentionPolicyCache,
    dataRetention,
    share,
    sharedTraceCache,
    commands,
    ops,
    _eventSourcing: es,
    _gracefulCloseables: gracefulCloseables,
  });
}

/** Tests — noop commands, null-backed services. */
export function createTestApp(overrides?: Partial<AppDependencies>): App {
  const testPrisma = globalPrisma;
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
  // Hoisted so the export shares the null repository with `runs`, matching how
  // the production preset wires the pair.
  const testSimulationReads = SimulationRunService.create(null);
  const noop = async () => {
    /* noop */
  };
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

  const nullOrganizations = traced(
    new OrganizationService(new NullOrganizationRepository(), {
      seedForOrg: async () => {
        /* noop */
      },
    } as unknown as PromptTagRepository),
    "OrganizationService",
  );
  const nullProjects = traced(
    new ProjectService(
      new NullProjectRepository(),
      new NullLwqlKeyMapRepository(),
    ),
    "ProjectService",
  );

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
  const testGithubAppTokens = new GithubAppTokenService("", "", null);
  const testGithubInstallations = new GithubInstallationsService(
    new NullGithubInstallationsRepository(),
    testGithubAppTokens,
  );
  const testPullRequestsRepository = new NullGithubPullRequestsRepository();
  const testGithubPullRequestMapping = new GithubPullRequestMappingService({
    repository: testPullRequestsRepository,
    installations: testGithubInstallations,
    appTokens: testGithubAppTokens,
    resolveOrganizationId: async () => undefined,
    findProjectIds: async () => [],
    sessions: testCodingAgentSessions,
  });
  const testPullRequestUsage = new PullRequestUsageService({
    pullRequests: testPullRequestsRepository,
    sessions: new NullCodingAgentSessionRepository(),
    personalSessions: testCodingAgentSessions,
    sessionEvents: new NullCodingAgentSessionEventsRepository(),
    installations: testGithubInstallations,
    resolveOrganizationId: async () => undefined,
    // No enterprise policy in the test app: everything reads as billed, the
    // conservative answer for a cost.
    isSourceNonBillable: async () => false,
  });
  const testCodingAgentSessionsList = new CodingAgentSessionsListService({
    sessions: testCodingAgentSessions,
    pullRequests: new NullGithubPullRequestLookup(),
    resolveOrganizationId: async () => undefined,
  });
  return new App({
    config,
    broadcast: testBroadcast,
    presence: new PresenceService(
      new InMemoryPresenceRepository(),
      testBroadcast,
      nullProjects,
    ),
    traces: (() => {
      const nullEvalRuns = new EvaluationRunService(
        new NullEvaluationRunRepository(),
      );
      return {
        summary: traced(
          new TraceSummaryService(new NullTraceSummaryRepository()),
          "TraceSummaryService",
        ),
        list: traced(
          new TraceListService(
            new NullTraceListRepository(),
            nullEvalRuns,
            new TopicService(new NullTopicRepository()),
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
    evaluations: {
      runs: traced(
        new EvaluationRunService(new NullEvaluationRunRepository()),
        "EvaluationRunService",
      ),
      execution:
        void 0 as unknown as AppDependencies["evaluations"]["execution"],
      performance: new MonitorPerformanceService(
        new NullMonitorPerformanceRepository(),
      ),
      traceEvaluations: new TraceEvaluationsClickHouseRepository(async () => {
        throw new Error("ClickHouse is not available in the test app");
      }),
    },
    dspySteps: { steps: new DspyStepService(new NullDspyStepRepository()) },
    analytics: {
      service: createAnalyticsService({
        resolveClient: async () => {
          throw new Error("ClickHouse not available in test app");
        },
        legacyBackend: new ClickHouseAnalyticsService(null),
      }),
    },
    experiments: ExperimentService.create({
      prisma: testPrisma,
      broadcaster: testBroadcast,
    }),
    triggers: new TriggerService(new NullTriggerRepository()),
    emailSuppressions: new EmailSuppressionService(
      new NullEmailSuppressionRepository(),
      new NullEmailSuppressionNameLookupRepository(),
    ),
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
    simulations: {
      runs: testSimulationReads,
      export: ScenarioRunExportService.create(testSimulationReads.repository),
    },
    suiteRuns: {
      runs: SuiteRunService.create({
        resolveClickHouseClient: null,
        startSuiteRun: noop,
        queueSimulationRun: noop,
      }),
    },
    topicClustering: {
      status: new TopicClusteringStatusService(
        new PrismaTopicClusteringStatusRepository(testPrisma),
      ),
      topics: new TopicService(new PrismaTopicRepository(testPrisma)),
      runPage: () => {
        throw new Error("Topic clustering is not available in the test app");
      },
    },
    gateway: {
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
      ocsfEvents: undefined,
      traceActivity: undefined,
      kpis: undefined,
      personalUsage: undefined,
    },
    billableEvents: undefined,
    codingAgents: {
      sessions: testCodingAgentSessions,
      sessionsList: testCodingAgentSessionsList,
      pullRequestUsage: testPullRequestUsage,
    },
    github: {
      installations: testGithubInstallations,
      pullRequests: {
        mapping: testGithubPullRequestMapping,
        status: new GithubPullRequestStatusService({
          repository: testPullRequestsRepository,
          installations: testGithubInstallations,
          appTokens: testGithubAppTokens,
          redis: null,
        }),
        repository: testPullRequestsRepository,
      },
    },
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
    langy: {
      conversations: LangyConversationService.create(
        {
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
        new NullLangyConversationRepository(),
      ),
      turns: LangyTurnService.create({
        conversations: void 0 as unknown as LangyConversationService,
        credentials: void 0 as unknown as LangyCredentialService,
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
        admission: new NullLangyTurnAdmissionRepository(),
        accessStore: null,
        handoffStore: null,
        messages: new NullLangyMessageRepository(),
      }),
      messages: new LangyMessageService(
        new NullLangyMessageRepository(),
        new NullLangyConversationRepository(),
      ),
      credentials: LangyCredentialService.create(testPrisma),
      feedbackPrompt: new LangyFeedbackPromptService({ redis: null }),
    },
    organizations: nullOrganizations,
    projects: nullProjects,
    permissions: permissionsServiceFor(testPrisma),
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
    notifications: NotificationService.createNull(),
    nurturing: undefined,
    usageLimits: UsageLimitService.createNull(),
    ops: {
      queues: new QueueService({ repo: new NullQueueRepository() }),
      scheduler: new SchedulerOpsService({
        repo: new NullScheduledJobRepository(),
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
      experimentRuns: {
        startExperimentRun: noop,
        recordTargetResult: noop,
        recordEvaluatorResult: noop,
        computeExperimentRunMetrics: noop,
        completeExperimentRun: noop,
      } as AppCommands["experimentRuns"],
      simulations: {
        queueRun: noop,
        startRun: noop,
        messageSnapshot: noop,
        textMessageStart: noop,
        textMessageEnd: noop,
        finishRun: noop,
        cancelRun: noop,
        deleteRun: noop,
        computeRunMetrics: noop,
      } as AppCommands["simulations"],
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
      ...createNoopEnterprisePipelineCommands(),
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
      // (rather than `grantsLedgerWriter()`, which always reaches for the
      // app's Prisma singleton) - today the two are the same client
      // (`testPrisma = globalPrisma`, presets.ts above), but a test preset
      // should say what it depends on rather than rely on that coincidence.
      new LedgerShareRepository({
        legacy: new PrismaShareRepository(testPrisma),
        prisma: testPrisma,
        writer: () => new GrantsLedgerWriter(testPrisma),
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
    ...overrides,
  });
}
