import type { ClickHouseClient } from "@clickhouse/client";
import { GovernanceKpisClickHouseRepository } from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { GovernanceOcsfEventsClickHouseRepository } from "@ee/governance/services/governanceOcsfEvents.clickhouse.repository";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { env } from "~/env.mjs";
import {
  type ClickHouseClientResolver,
  clearCustomClientCache,
  getClickHouseClientForProject,
  getClickHouseClientForOrganization,
  getSharedClickHouseClient,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { closeClickHouseClient } from "~/server/clickhouse/client";
import { prisma as globalPrisma } from "~/server/db";
import { getFeatureFlagStore } from "~/server/featureFlag/featureFlagStore.postgres";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetRepository } from "~/server/gateway/budget.repository";
import { getEdgeSpoolFailOpenCounter } from "~/server/metrics";
import { getPostHogInstance } from "~/server/posthog";
import { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { createS3Client } from "~/server/storage";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import { liveTriggerNotifier } from "~/server/app-layer/automations/delivery/triggerNotifier";
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
import {
  NullScheduledJobRepository,
  PrismaScheduledJobRepository,
} from "./scheduler/scheduled-job.repository";
import { schedulerRegistry } from "./scheduler/scheduler.registry";
import { SchedulerService } from "./scheduler/scheduler.service";
import { getAnalyticsService } from "./analytics";
import { loadReportCharts } from "./reports/report-chart.service";
import { dispatchScheduledReport } from "./reports/report-dispatch";
import { toReportTraceRow } from "./reports/trace-report-row";
import { translateFilterToClickHouse } from "./traces/filter-to-clickhouse";
import { REPORT_SCHEDULER_TARGET_TYPE } from "./automations/report.builder";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import { EventSourcing } from "../event-sourcing";
import type { PipelineRepositories } from "../event-sourcing/pipelineRegistry";
import {
  type AppCommands,
  PipelineRegistry,
} from "../event-sourcing/pipelineRegistry";
import { createExperimentRunItemAppendStore } from "../event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.store";
import {
  ExperimentRunStateRepositoryClickHouse,
  ExperimentRunStateRepositoryMemory,
} from "../event-sourcing/pipelines/experiment-run-processing/repositories";
import { LangyConversationService } from "./langy/langy-conversation.service";
import { LangyTurnService } from "./langy/langy-turn.service";
import { LangyCredentialService } from "~/server/app-layer/langy/LangyCredentialService";
import { createLangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import { getVercelAIModel } from "~/server/modelProviders/utils";
import {
  mintLangySessionApiKey,
  revokeLangySessionApiKey,
} from "~/server/app-layer/langy/langyApiKey";
import {
  LANGY_GITHUB_PRS_PER_DAY,
  releaseLangyGithubPrPermit,
  reserveLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { createLangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import { createLangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { createLangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import { LangyFeedbackPromptService } from "~/server/app-layer/langy/langy-feedback-prompt.service";
import { LangyGithubInstallationsService } from "./langy/langy-github-installations.service";
import {
  LangyGithubAppTokenService,
  type RedisLike,
} from "./langy/langyGithubAppToken";
import {
  createLangyTrustedMessageReader,
  LangyMessageService,
} from "./langy/langy-message.service";
import { PrismaLangyMessageRepository } from "./langy/repositories/langy-message.prisma.repository";
import { NullLangyMessageRepository } from "./langy/repositories/langy-message.repository";
import { NullLangyGithubInstallationsRepository } from "./langy/repositories/langy-github-installations.repository";
import { PrismaLangyGithubInstallationsRepository } from "./langy/repositories/langy-github-installations.prisma.repository";
import { createLangyConversationTitleGenerator } from "./langy/langy-title-generation.service";
import { PrismaLangyConversationProjectionRepository } from "./langy/repositories/langy-conversation-projection.prisma.repository";
import { PrismaLangyConversationTurnProjectionRepository } from "./langy/repositories/langy-conversation-turn-projection.prisma.repository";
import { PrismaLangyMessageProjectionRepository } from "./langy/repositories/langy-message-projection.prisma.repository";
import { PrismaLangyConversationRepository } from "./langy/repositories/langy-conversation.prisma.repository";
import { NullLangyConversationRepository } from "./langy/repositories/langy-conversation.repository";
import { PrismaLangyTurnAdmissionRepository } from "./langy/repositories/langy-turn-admission.prisma.repository";
import { NullLangyTurnAdmissionRepository } from "./langy/repositories/langy-turn-admission.repository";
import { ClickHouseLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.clickhouse.repository";
import { NullLangyAnalyticsEventRepository } from "./langy/repositories/langy-analytics-event.repository";
import { LangyAnalyticsEventAppendStore } from "../event-sourcing/pipelines/langy-conversation-processing/projections/langyAnalyticsEvent.store";
import { PrismaProcessStore } from "../event-sourcing/process-manager";
import { PrismaTopicClusteringRunHistoryProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-history-projection.prisma.repository";
import { PrismaTopicClusteringRunProjectionRepository } from "./topic-clustering/repositories/topic-clustering-run-projection.prisma.repository";
import { PrismaTopicModelProjectionRepository } from "./topic-clustering/repositories/topic-model-projection.prisma.repository";
import { startTopicClusteringBootSeeds } from "./topic-clustering/bootSeeds";
import { PrismaTopicClusteringStatusRepository } from "./topic-clustering/repositories/topic-clustering-status.repository";
import { TopicClusteringStatusService } from "./topic-clustering/topic-clustering-status.service";
import { clusterTopicsForProject } from "./topic-clustering/clustering";
import { createNoopEnterprisePipelineCommands } from "@ee/event-sourcing/pipelineSet";
import type { ScenarioExecutionReactorHandle } from "../event-sourcing/pipelines/simulation-processing/reactors/scenarioExecution.reactor";
import {
  SimulationRunStateRepositoryClickHouse,
  SimulationRunStateRepositoryMemory,
} from "../event-sourcing/pipelines/simulation-processing/repositories";
import {
  SuiteRunStateRepositoryClickHouse,
  SuiteRunStateRepositoryMemory,
} from "../event-sourcing/pipelines/suite-run-processing/repositories";
import { ExperimentService } from "../experiments/experiment.service";
import { InviteService } from "../invites/invite.service";
import { OrganizationRepository } from "../repositories/organization.repository";
import { getLicenseHandler } from "../subscriptionHandler";
import { EventUsageService } from "../traces/event-usage.service";
import { TraceService } from "../traces/trace.service";
import { TraceUsageService } from "../traces/trace-usage.service";
import { runEvaluationWorkflow } from "../workflows/runWorkflow";
import { App, getApp, globalForApp, initializeApp } from "./app";
import { PrismaBillingCheckpointService } from "./billing/billingCheckpoint.service";
import { BroadcastService } from "./broadcast/broadcast.service";
import { createClickHouseClientFromConfig } from "./clients/clickhouse.factory";
import { NullLangevalsClient } from "./clients/langevals/langevals.client";
import { LangEvalsHttpClient } from "./clients/langevals/langevals.http.client";
import { createRedisConnectionFromConfig } from "./clients/redis.factory";
import { TiktokenClient } from "./clients/tokenizer/tiktoken.client";
import { NullTokenizerClient } from "./clients/tokenizer/tokenizer.client";
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
import { EvaluationAnalyticsClickHouseRepository } from "./evaluations/repositories/evaluation-analytics.clickhouse.repository";
import { NullEvaluationAnalyticsRepository } from "./evaluations/repositories/evaluation-analytics.repository";
import { EvaluationAnalyticsRollupClickHouseRepository } from "./evaluations/repositories/evaluation-analytics-rollup.clickhouse.repository";
import { NullEvaluationAnalyticsRollupRepository } from "./evaluations/repositories/evaluation-analytics-rollup.repository";
import { EvaluationRunClickHouseRepository } from "./evaluations/repositories/evaluation-run.clickhouse.repository";
import { NullEvaluationRunRepository } from "./evaluations/repositories/evaluation-run.repository";
import { CanonicalLogRecordClickHouseRepository } from "./logs/repositories/canonical-log-record.clickhouse.repository";
import { NullCanonicalLogRecordRepository } from "./logs/repositories/canonical-log-record.repository";
import { MonitorService } from "./monitors/monitor.service";
import { PrismaMonitorRepository } from "./monitors/repositories/monitor.prisma.repository";
import { EventExplorerService } from "./ops/event-explorer.service";
import { getOpsMetricsCollector } from "./ops/metrics-collector";
import { QueueService } from "./ops/queue.service";
import { SchedulerOpsService } from "./ops/scheduler-ops.service";
import { ReplayService } from "./ops/replay.service";
import { EventExplorerClickHouseRepository } from "./ops/repositories/event-explorer.clickhouse.repository";
import { NullEventExplorerRepository } from "./ops/repositories/event-explorer.repository";
import { QueueRedisRepository } from "./ops/repositories/queue.redis.repository";
import { NullQueueRepository } from "./ops/repositories/queue.repository";
import { ReplayRedisRepository } from "./ops/repositories/replay.redis.repository";
import { NullReplayRepository } from "./ops/repositories/replay.repository";
import { OrganizationService } from "./organizations/organization.service";
import { PrismaOrganizationRepository } from "./organizations/repositories/organization.prisma.repository";
import { NullOrganizationRepository } from "./organizations/repositories/organization.repository";
import { PresenceService } from "./presence/presence.service";
import { InMemoryPresenceRepository } from "./presence/repositories/presence.memory.repository";
import { RedisPresenceRepository } from "./presence/repositories/presence.redis.repository";
import { ProjectService } from "./projects/project.service";
import { PrismaProjectRepository } from "./projects/repositories/project.prisma.repository";
import { NullProjectRepository } from "./projects/repositories/project.repository";
import { PrismaShareRepository } from "./share/repositories/share.prisma.repository";
import { ShareService } from "./share/share.service";
import { SimulationRunService } from "./simulations/simulation-run.service";
import { createCompositePlanProvider } from "./subscription/composite-plan-provider";
import { PlanProviderService } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import { SuiteRunService } from "./suites/suite-run.service";
import { NullTopicRepository } from "./topic-clustering/repositories/null-topic.repository";
import { PrismaTopicRepository } from "./topic-clustering/repositories/topic.prisma.repository";
import { TopicService } from "./topic-clustering/topic.service";
import { maybeExtractSpanMedia } from "./traces/edge-media-extraction";
import { maybeSpool } from "./traces/edge-spool";
import { LogRecordStorageService } from "./traces/log-record-storage.service";
import { LogRequestCollectionService } from "./traces/log-request-collection.service";
import { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import { LogRecordStorageClickHouseRepository } from "./traces/repositories/log-record-storage.clickhouse.repository";
import { NullLogRecordStorageRepository } from "./traces/repositories/log-record-storage.repository";
import { MetricDataPointClickHouseRepository } from "./metrics/repositories/metric-data-point.clickhouse.repository";
import { NullMetricDataPointRepository } from "./metrics/repositories/metric-data-point.repository";
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
import { EmailSuppressionService } from "./automations/emailSuppression.service";
import { buildAutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.wiring";
import { ClickHouseAutomationAuditRepository } from "./automations/repositories/automation-audit.clickhouse.repository";
import { NullAutomationAuditRepository } from "@langwatch/automations/repositories/automation-audit.repository";
import {
  PrismaEmailSuppressionNameLookupRepository,
  PrismaEmailSuppressionRepository,
} from "./automations/repositories/emailSuppression.prisma.repository";
import {
  NullEmailSuppressionNameLookupRepository,
  NullEmailSuppressionRepository,
} from "@langwatch/automations/repositories/emailSuppression.repository";
import { PrismaTriggerRepository } from "./automations/repositories/trigger.prisma.repository";
import { NullTriggerRepository } from "@langwatch/automations/repositories/trigger.repository";
import { TriggerService } from "./automations/trigger.service";
import { testFireTrigger } from "./automations/trigger-template.service";
import { UsageService } from "./usage/usage.service";

/**
 * Late-bound handle for the scenario execution reactor.
 * Stored on globalForApp to survive hot-reload in dev (same as the App instance).
 */
export function getScenarioExecutionHandle(): ScenarioExecutionReactorHandle | null {
  return (globalForApp as any).__scenarioExecutionHandle ?? null;
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
  const config = createAppConfigFromEnv({ processRole: options?.processRole });

  const clickhouseEnabled = !!config.clickhouseUrl || isClickHouseEnabled();

  // Resolver: given a tenantId (projectId), returns the right ClickHouse client
  const resolveClickHouseClient: ClickHouseClientResolver = async (
    tenantId: string,
  ): Promise<ClickHouseClient> => {
    const client = await getClickHouseClientForProject(tenantId);
    if (!client)
      throw new Error(`ClickHouse not available for tenant ${tenantId}`);
    return client;
  };

  const redis = config.skipRedis
    ? null
    : createRedisConnectionFromConfig({
        url: config.redisUrl,
        clusterEndpoints: config.redisClusterEndpoints,
        db: config.redisDbIndex,
      });

  const broadcast = new BroadcastService(redis);
  const projects = traced(
    new ProjectService(new PrismaProjectRepository(prisma)),
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

  // ADR-022: construct blob/IO deps and the shared span-storage repository
  // before TraceSummaryService and SpanStorageService, so both can resolve
  // offloaded eventref pointers (the v2 header's full=true read, and the v2
  // spans read) from the same instances. #4888: the same factory backs the
  // customer-facing full=true read path; the composition root passes its own
  // ClickHouse decision/resolver so the eval-path deps stay byte-identical to
  // the pre-#4888 inline wiring.
  const { blobStore, ioExtractionService } = buildTraceBlobResolutionDeps({
    clickhouseEnabled,
    resolveClickHouseClient,
  });
  const spanStorageRepository = clickhouseEnabled
    ? new SpanStorageClickHouseRepository(resolveClickHouseClient)
    : new NullSpanStorageRepository();

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
        ? new EvaluationRunClickHouseRepository(resolveClickHouseClient)
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
    new LogRecordStorageService(
      clickhouseEnabled
        ? new LogRecordStorageClickHouseRepository(resolveClickHouseClient)
        : new NullLogRecordStorageRepository(),
    ),
    "LogRecordStorageService",
  );
  const experiments = traced(
    ExperimentService.create(prisma),
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

  // Resolves the per-tenant retention cascade; shared by the DSPy CH repo
  // (which stamps dspy_steps as a traces-category table) and the data-retention
  // services wired further below.
  const dataRetentionPolicyRepo = new DataRetentionPolicyRepository(prisma);
  const retentionPolicyCache = new RetentionPolicyCache(
    dataRetentionPolicyRepo,
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
  const simulationReads = SimulationRunService.create(
    clickhouseEnabled ? resolveClickHouseClient : null,
  );
  // SuiteRunService is created after pipeline registration (needs startSuiteRun command)

  const evaluations = {
    runs: evaluationRuns,
    execution: evaluationExecution,
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
    simulationReads,
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
    : PlanProviderService.create({
        getActivePlan: async ({ organizationId }) => {
          const plan = await getLicenseHandler().getActivePlan(organizationId);
          return {
            ...plan,
            planSource: plan.free ? ("free" as const) : ("license" as const),
          };
        },
      });

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
  const shareRepo = new PrismaShareRepository(prisma);
  const pinnedTraceService = new PinnedTraceService(
    pinnedTraceRepo,
    async ({ projectId, traceId }) => {
      const share = await shareRepo.findByResource({
        projectId,
        resourceType: "TRACE",
        resourceId: traceId,
      });
      return share !== null;
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
    new ShareService(shareRepo, pinnedTraceService),
    "ShareService",
  );

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
    experimentRunState: clickhouseEnabled
      ? new ExperimentRunStateRepositoryClickHouse(resolveClickHouseClient)
      : new ExperimentRunStateRepositoryMemory(),
    traceSummaryFold: clickhouseEnabled
      ? new TraceSummaryClickHouseRepository(resolveClickHouseClient)
      : traceSummary.repository,
    logRecordStorage: clickhouseEnabled
      ? new LogRecordStorageClickHouseRepository(resolveClickHouseClient)
      : new NullLogRecordStorageRepository(),
    canonicalLogStorage: clickhouseEnabled
      ? new CanonicalLogRecordClickHouseRepository(resolveClickHouseClient)
      : new NullCanonicalLogRecordRepository(),
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
    automationAudit: clickhouseEnabled
      ? new ClickHouseAutomationAuditRepository(resolveClickHouseClient)
      : new NullAutomationAuditRepository(),
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
    topicClusteringRunStatus: new PrismaTopicClusteringRunProjectionRepository(
      prisma,
    ),
    topicClusteringRunHistory:
      new PrismaTopicClusteringRunHistoryProjectionRepository(prisma),
    topicModel: new PrismaTopicModelProjectionRepository(prisma),
    langyTurnAdmission,
  };

  const gatewayBudgetSync = clickhouseEnabled
    ? {
        prisma,
        budgetRepository: new GatewayBudgetRepository(prisma),
        budgetCHRepository: new GatewayBudgetClickHouseRepository(
          resolveClickHouseClient,
        ),
      }
    : undefined;

  const governanceKpisSync = clickhouseEnabled
    ? {
        governanceKpisRepository: new GovernanceKpisClickHouseRepository(
          resolveClickHouseClient,
        ),
      }
    : undefined;

  const governanceOcsfEventsSync = clickhouseEnabled
    ? {
        governanceOcsfEventsRepository:
          new GovernanceOcsfEventsClickHouseRepository(resolveClickHouseClient),
      }
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
                  loadCustomGraph: ({ projectId, customGraphId }) =>
                    prisma.customGraph.findFirst({
                      where: { id: customGraphId, projectId },
                    }),
                  loadDashboardGraphs: ({ projectId, dashboardId }) =>
                    prisma.customGraph.findMany({
                      where: { dashboardId, projectId },
                      orderBy: [{ gridRow: "asc" }, { gridColumn: "asc" }],
                    }),
                  getTimeseries: (input) =>
                    getAnalyticsService().getTimeseries(input),
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

  const registry = new PipelineRegistry({
    eventSourcing: es,
    repositories,
    redis: redis!,
    broadcast,
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
          clusterTopicsForProject(projectId, searchAfter ?? undefined, {
            runId,
            page,
          }),
      },
    },
    enterprisePipelines: {
      prisma,
      runsWorkers: roleRunsWorkers(config.processRole),
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
    gatewayBudgetSync,
    // ADR-022: Inject BlobStore into the pipeline registry so RecordSpanCommand
    // can reconstitute oversized commands (fetch from transient S3 spool) and
    // best-effort delete the spool after event_log INSERT succeeds.
    blobStore,
    governanceKpisSync,
    governanceOcsfEventsSync,
  });
  const commands = registry.registerAll();
  (globalForApp as any).__scenarioExecutionHandle =
    commands.scenarioExecutionHandle;

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
  // commands against the canonical ClickHouse event log.
  const langyConversations = LangyConversationService.create(
    commands.langy,
    langyConversationRepository,
    langyMessageRepository,
  );
  const langyMessages = new LangyMessageService(
    langyMessageRepository,
    langyConversationRepository,
  );

  // Langy GitHub App installations (issue #4747): the install/webhook lifecycle
  // and the per-turn installation-token mint for bot-authored PRs. The App is
  // optional per instance; when the private key is unset the service reports
  // `configured=false` and every read short-circuits to "GitHub unavailable"
  // without touching GitHub. The App private key is the only credential and it
  // lives here in the control plane, never near a worker.
  const langyGithubAppTokens = new LangyGithubAppTokenService(
    env.GITHUB_LANGY_APP_ID ?? "",
    env.GITHUB_LANGY_PRIVATE_KEY ?? "",
    // ioredis Redis/Cluster satisfy the narrow RedisLike surface at runtime; the
    // client's overloaded `set` signature just isn't structurally assignable.
    (redis ?? null) as unknown as RedisLike | null,
  );
  const langyGithubInstallations = new LangyGithubInstallationsService(
    new PrismaLangyGithubInstallationsRepository(prisma),
    langyGithubAppTokens,
  );

  // Langy turn-start orchestration (LANGY_REWORK_PLAN.md S2 C): the pipeline the
  // Hono route used to inline, now an app-layer service with injected ports. The
  // worker port + turn stores are null when their infra is absent (no agent env /
  // no Redis); the service raises LangyAgentUnavailableError in that case, exactly
  // as the route 503'd.
  const langyTurns = LangyTurnService.create({
    conversations: langyConversations,
    credentials: LangyCredentialService.create(prisma),
    resolveModel: getVercelAIModel,
    worker: langyAgentUrl && langyInternalSecret ? langyWorker : null,
    // The durable buffer backs a user Stop: reconstruct the partial answer and
    // end the live stream (ADR-058). Null without Redis, like the stores below.
    tokenBuffer: redis ? langyTokenBuffer : null,
    reservePermit: reserveLangyGithubPrPermit,
    releasePermit: releaseLangyGithubPrPermit,
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
      // ADR-022: Edge size-check + transient S3 spool, flag-gated per project.
      // projectId === tenantId (routes/otel.ts passes project.id). processCommandData
      // runs PER SPAN (not once per OTLP request/batch); the flag is read per span and
      // the 5s-cached flag store keeps that per-span read cheap.
      //
      // FAIL-OPEN: any error from the flag store (Postgres/network blip) or
      // from maybeSpool (S3 outage, BlobStore.putSpool throws) is caught here.
      // We log at warn level and return the original commandData unchanged so
      // that ingestion is never blocked by the spool path. ADR-022.
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
          const enabled = await getFeatureFlagStore().get(
            "release_trace_blob_offload",
            { projectId: data.tenantId },
          );
          if (enabled !== true) return data;
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
            "Edge spool failed — falling back to unmodified command data (fail-open)",
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

  const traces = {
    summary: traceSummary,
    list: traceList,
    spans: spanStorage,
    logRecords: logRecordStorage,
    collection: traceCollection,
    logCollection,
    metricCollection,
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
  const sharedCh = getSharedClickHouseClient();
  const eventExplorerRepo = sharedCh
    ? new EventExplorerClickHouseRepository(sharedCh)
    : new NullEventExplorerRepository();

  const ops = {
    queues: new QueueService(queueRepo),
    scheduler: new SchedulerOpsService(
      new PrismaScheduledJobRepository(prisma),
    ),
    eventExplorer: new EventExplorerService(eventExplorerRepo),
    replay: new ReplayService(replayRepo),
    metricsCollector: redis
      ? getOpsMetricsCollector({ redis, queueRepo })
      : null,
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
    simulations: { runs: simulationReads },
    suiteRuns: { runs: suiteRunService },
    topicClustering: {
      status: new TopicClusteringStatusService(
        new PrismaTopicClusteringStatusRepository(prisma),
      ),
      topics,
    },
    // traced() gives every service call a `ClassName.method` span, same as
    // the rest of the app bag. Per-method, not per-frame: the streaming hot
    // paths (token buffer, relay frames) stay span-free by design.
    langy: {
      conversations: traced(langyConversations, "LangyConversationService"),
      turns: traced(langyTurns, "LangyTurnService"),
      messages: traced(langyMessages, "LangyMessageService"),
      githubInstallations: traced(
        langyGithubInstallations,
        "LangyGithubInstallationsService",
      ),
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
    new ProjectService(new NullProjectRepository()),
    "ProjectService",
  );

  const testBroadcast = new BroadcastService(null);
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
        spans: traced(
          new SpanStorageService(new NullSpanStorageRepository()),
          "SpanStorageService",
        ),
        logRecords: traced(
          new LogRecordStorageService(new NullLogRecordStorageRepository()),
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
      };
    })(),
    evaluations: {
      runs: traced(
        new EvaluationRunService(new NullEvaluationRunRepository()),
        "EvaluationRunService",
      ),
      execution:
        void 0 as unknown as AppDependencies["evaluations"]["execution"],
    },
    dspySteps: { steps: new DspyStepService(new NullDspyStepRepository()) },
    experiments: ExperimentService.create(testPrisma),
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
    simulations: { runs: SimulationRunService.create(null) },
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
      githubInstallations: new LangyGithubInstallationsService(
        new NullLangyGithubInstallationsRepository(),
        new LangyGithubAppTokenService("", "", null),
      ),
      credentials: LangyCredentialService.create(testPrisma),
      feedbackPrompt: new LangyFeedbackPromptService({ redis: null }),
    },
    organizations: nullOrganizations,
    projects: nullProjects,
    tokenizer: new TokenizerService(new NullTokenizerClient()),
    usage: new UsageService(
      nullOrganizations,
      TraceUsageService.create(),
      new EventUsageService(),
      async () => FREE_PLAN,
      null,
      SimulationRunService.create(null),
    ),
    planProvider: PlanProviderService.create({
      getActivePlan: async () => FREE_PLAN,
    }),
    subscription: undefined,
    notifications: NotificationService.createNull(),
    nurturing: undefined,
    usageLimits: UsageLimitService.createNull(),
    ops: {
      queues: new QueueService(new NullQueueRepository()),
      scheduler: new SchedulerOpsService(new NullScheduledJobRepository()),
      eventExplorer: new EventExplorerService(
        new NullEventExplorerRepository(),
      ),
      replay: new ReplayService(new NullReplayRepository()),
      metricsCollector: null,
    },
    commands: {
      traces: {
        recordSpan: noop,
        assignTopic: noop,
        recordLog: noop,
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
      scenarioExecutionHandle: {
        reactor: {
          name: "scenarioExecution",
          options: { runIn: ["worker"] },
          handle: async () => {
            /* noop */
          },
        },
        setPool: () => {
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
      new PrismaShareRepository(testPrisma),
      testPinnedTraceService,
    ),
    ...overrides,
  });
}
