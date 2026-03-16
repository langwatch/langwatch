import type { PrismaClient } from "@prisma/client";
import { esClient, TRACE_INDEX, traceIndexId } from "../elasticsearch";
import { EventSourcing } from "../event-sourcing";
import { PipelineRegistry, type AppCommands } from "../event-sourcing/pipelineRegistry";
import { App, getApp, globalForApp, initializeApp } from "./app";
import { BroadcastService } from "./broadcast/broadcast.service";
import { createClickHouseClientFromConfig } from "./clients/clickhouse.factory";
import { NullLangevalsClient } from "./clients/langevals/langevals.client";
import { LangEvalsHttpClient } from "./clients/langevals/langevals.http.client";
import { createRedisConnectionFromConfig } from "./clients/redis.factory";
import { TiktokenClient } from "./clients/tokenizer/tiktoken.client";
import { NullTokenizerClient } from "./clients/tokenizer/tokenizer.client";
import { createAppConfigFromEnv, type AppConfig, type ProcessRole } from "./config";
import type { AppDependencies } from "./dependencies";
import { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import { createDefaultModelEnvResolver } from "./evaluations/evaluation-execution.factories";
import { EvaluationRunService } from "./evaluations/evaluation-run.service";
import { EvaluationRunClickHouseRepository } from "./evaluations/repositories/evaluation-run.clickhouse.repository";
import { NullEvaluationRunRepository } from "./evaluations/repositories/evaluation-run.repository";
import { MonitorService } from "./monitors/monitor.service";
import { PrismaMonitorRepository } from "./monitors/repositories/monitor.prisma.repository";
import { OrganizationService } from "./organizations/organization.service";
import { PrismaOrganizationRepository } from "./organizations/repositories/organization.prisma.repository";
import { NullOrganizationRepository } from "./organizations/repositories/organization.repository";
import { ProjectService } from "./projects/project.service";
import { PrismaProjectRepository } from "./projects/repositories/project.prisma.repository";
import { NullProjectRepository } from "./projects/repositories/project.repository";
import { DspyStepService } from "./dspy-steps/dspy-step.service";
import { DspyStepClickHouseRepository } from "./dspy-steps/repositories/dspy-step.clickhouse.repository";
import { NullDspyStepRepository } from "./dspy-steps/repositories/dspy-step.repository";
import { SimulationRunService } from "./simulations/simulation-run.service";
import { SuiteRunService } from "./suites/suite-run.service";
import { createSpanDedupeService } from "./traces/span-dedupe.service";
import { LogRecordStorageService } from "./traces/log-record-storage.service";
import { LogRecordStorageClickHouseRepository } from "./traces/repositories/log-record-storage.clickhouse.repository";
import { NullLogRecordStorageRepository } from "./traces/repositories/log-record-storage.repository";
import { MetricRecordStorageService } from "./traces/metric-record-storage.service";
import { MetricRecordStorageClickHouseRepository } from "./traces/repositories/metric-record-storage.clickhouse.repository";
import { NullMetricRecordStorageRepository } from "./traces/repositories/metric-record-storage.repository";
import { SpanStorageService } from "./traces/span-storage.service";
import { SpanStorageClickHouseRepository } from "./traces/repositories/span-storage.clickhouse.repository";
import { NullSpanStorageRepository } from "./traces/repositories/span-storage.repository";
import { TokenizerService } from "./traces/tokenizer.service";
import { LogRequestCollectionService } from "./traces/log-request-collection.service";
import { MetricRequestCollectionService } from "./traces/metric-request-collection.service";
import { TraceRequestCollectionService } from "./traces/trace-request-collection.service";
import { TraceSummaryService } from "./traces/trace-summary.service";
import { TraceSummaryClickHouseRepository } from "./traces/repositories/trace-summary.clickhouse.repository";
import { NullTraceSummaryRepository } from "./traces/repositories/trace-summary.repository";
import { PlanProviderService } from "./subscription/plan-provider";
import { createCompositePlanProvider } from "./subscription/composite-plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import { EESubscriptionService } from "../../../ee/billing/services/subscription.service";
import { getSaaSPlanProvider } from "../../../ee/billing";
import { getLicenseHandler } from "../subscriptionHandler";
import { FREE_PLAN } from "../../../ee/licensing/constants";
import { createStripeClient } from "../../../ee/billing/stripe/stripeClient";
import { createSeatEventSubscriptionFns } from "../../../ee/billing/services/seatEventSubscription";
import * as subscriptionItemCalculator from "../../../ee/billing/services/subscriptionItemCalculator";
import { UsageService } from "./usage/usage.service";
import { TraceUsageService } from "../traces/trace-usage.service";
import { EventUsageService } from "../traces/event-usage.service";
import { OrganizationRepository } from "../repositories/organization.repository";
import { StripeUsageReportingService } from "../../../ee/billing/services/usageReportingService";
import { meters } from "../../../ee/billing/stripe/stripePriceCatalog";
import { NotificationService } from "../../../ee/billing/notifications/notification.service";
import { NotificationRepository } from "../../../ee/billing/notifications/repositories/notification.repository";
import { UsageLimitService } from "../../../ee/billing/notifications/usage-limit.service";
import { traced } from "./tracing";
import { TraceService } from "../traces/trace.service";
import { createCostChecker } from "../license-enforcement/license-enforcement.repository";
import { runEvaluationWorkflow } from "../workflows/runWorkflow";

export function initializeWebApp(): App {
  return initializeDefaultApp({ processRole: "web" });
}

export function initializeWorkerApp(): App {
  return initializeDefaultApp({ processRole: "worker" });
}

export function initializeDefaultApp(options?: { processRole?: ProcessRole }): App {
  if (globalForApp.__langwatch_app) return globalForApp.__langwatch_app;

  const { prisma } = require("../db") as { prisma: PrismaClient; };
  const config = createAppConfigFromEnv({ processRole: options?.processRole });

  const clickhouse = createClickHouseClientFromConfig({
    url: config.clickhouseUrl,
    enabled: config.enableClickhouse,
  });
  const redis = config.skipRedis ? null : createRedisConnectionFromConfig({
    url: config.redisUrl,
    clusterEndpoints: config.redisClusterEndpoints,
  });

  const broadcast = new BroadcastService(redis);
  const spanDedup = createSpanDedupeService(redis);

  const traceSummary = traced(
    new TraceSummaryService(
      clickhouse ? new TraceSummaryClickHouseRepository(clickhouse) : new NullTraceSummaryRepository(),
    ),
    "TraceSummaryService",
  );
  const spanStorage = traced(
    new SpanStorageService(
      clickhouse ? new SpanStorageClickHouseRepository(clickhouse) : new NullSpanStorageRepository(),
    ),
    "SpanStorageService",
  );
  const logRecordStorage = traced(
    new LogRecordStorageService(
      clickhouse ? new LogRecordStorageClickHouseRepository(clickhouse) : new NullLogRecordStorageRepository(),
    ),
    "LogRecordStorageService",
  );
  const metricRecordStorage = traced(
    new MetricRecordStorageService(
      clickhouse ? new MetricRecordStorageClickHouseRepository(clickhouse) : new NullMetricRecordStorageRepository(),
    ),
    "MetricRecordStorageService",
  );

  const evaluationRuns = traced(
    new EvaluationRunService(
      clickhouse ? new EvaluationRunClickHouseRepository(clickhouse) : new NullEvaluationRunRepository(),
    ),
    "EvaluationRunService",
  );

  const organizations = traced(
    new OrganizationService(new PrismaOrganizationRepository(prisma)),
    "OrganizationService",
  );
  const projects = traced(
    new ProjectService(new PrismaProjectRepository(prisma)),
    "ProjectService",
  );

  const traceService = TraceService.create(prisma);

  const evaluationExecution = traced(
    new EvaluationExecutionService({
      traceService,
      projectService: projects,
      costChecker: createCostChecker(prisma),
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
      clickhouse ? new DspyStepClickHouseRepository(clickhouse) : new NullDspyStepRepository(),
    ),
    "DspyStepService",
  );
  const simulationReads = SimulationRunService.create(clickhouse);
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
          return { ...plan, planSource: plan.free ? "free" as const : "license" as const };
        },
      });

  let subscription: SubscriptionService | undefined;
  let usageReportingService: StripeUsageReportingService | undefined;
  if (config.isSaas) {
    const stripeClient = createStripeClient();
    usageReportingService = new StripeUsageReportingService({ stripe: stripeClient, meterId: meters.BILLABLE_EVENTS });
    const seatEventFns = createSeatEventSubscriptionFns({ stripe: stripeClient, db: prisma });
    subscription = EESubscriptionService.create({
      stripe: stripeClient,
      db: prisma,
      itemCalculator: subscriptionItemCalculator,
      seatEventFns,
    });
  }

  const monitors = traced(
    new MonitorService(new PrismaMonitorRepository(prisma)),
    "MonitorService",
  );
  const tokenizer = new TokenizerService(
    config.disableTokenization ? new NullTokenizerClient() : new TiktokenClient(),
  );

  const es = new EventSourcing({
    clickhouse: clickhouse ?? void 0,
    redis,
    enabled: config.enableEventSourcing !== false,
    isSaas: config.isSaas,
    processRole: config.processRole,
  });

  const registry = new PipelineRegistry({
    eventSourcing: es,
    prisma,
    clickhouse,
    broadcast,
    projects,
    monitors,
    traces: { summary: traceSummary, spans: spanStorage },
    evaluations: { runs: evaluations.runs, execution: evaluations.execution },
    esSync: { esClient, traceIndex: TRACE_INDEX, traceIndexId, prisma },
    usageReportingService,
  });
  const commands = registry.registerAll();

  const suiteRunService = SuiteRunService.create({
    clickhouse,
    startSuiteRun: commands.suiteRuns.startSuiteRun,
    queueSimulationRun: commands.simulations.queueRun,
  });

  const traceCollection = traced(
    new TraceRequestCollectionService({
      dedup: spanDedup,
      recordSpan: commands.traces.recordSpan,
    }),
    "TraceRequestCollectionService",
  );

  const logCollection = traced(
    new LogRequestCollectionService({
      recordLog: commands.traces.recordLog,
    }),
    "LogRequestCollectionService",
  );

  const metricCollection = traced(
    new MetricRequestCollectionService({
      recordMetric: commands.traces.recordMetric,
    }),
    "MetricRequestCollectionService",
  );

  const traces = {
    summary: traceSummary,
    spans: spanStorage,
    logRecords: logRecordStorage,
    metricRecords: metricRecordStorage,
    collection: traceCollection,
    logCollection,
    metricCollection,
  };

  // Collect closeables for graceful shutdown
  const gracefulCloseables: Array<{
    name: string;
    close: () => Promise<void>;
  }> = [];
  if (clickhouse) {
    gracefulCloseables.push({
      name: "clickhouse",
      close: () => clickhouse.close(),
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

  return initializeApp({
    config,
    broadcast,
    traces,
    evaluations,
    dspySteps: { steps: dspySteps },
    simulations: { runs: simulationReads },
    suiteRuns: { runs: suiteRunService },
    organizations,
    projects,
    tokenizer,
    usage,
    planProvider,
    subscription,
    notifications,
    usageLimits,
    commands,
    _eventSourcing: es,
    _gracefulCloseables: gracefulCloseables,
  });
}

/** Tests — noop commands, null-backed services. */
export function createTestApp(overrides?: Partial<AppDependencies>): App {
  const noop = async () => { };
  const config: AppConfig = {
    nodeEnv: "test",
    databaseUrl: "postgresql://test@localhost/test",
    ...overrides?.config,
  };

  const nullOrganizations = traced(
    new OrganizationService(new NullOrganizationRepository()),
    "OrganizationService",
  );
  const nullProjects = traced(
    new ProjectService(new NullProjectRepository()),
    "ProjectService",
  );

  return new App({
    config,
    broadcast: new BroadcastService(null),
    traces: {
      summary: traced(new TraceSummaryService(new NullTraceSummaryRepository()), "TraceSummaryService"),
      spans: traced(new SpanStorageService(new NullSpanStorageRepository()), "SpanStorageService"),
      logRecords: traced(new LogRecordStorageService(new NullLogRecordStorageRepository()), "LogRecordStorageService"),
      metricRecords: traced(new MetricRecordStorageService(new NullMetricRecordStorageRepository()), "MetricRecordStorageService"),
      collection: traced(
        new TraceRequestCollectionService({
          dedup: createSpanDedupeService(null),
          recordSpan: noop,
        }),
        "TraceRequestCollectionService",
      ),
      logCollection: traced(
        new LogRequestCollectionService({
          recordLog: noop,
        }),
        "LogRequestCollectionService",
      ),
      metricCollection: traced(
        new MetricRequestCollectionService({
          recordMetric: noop,
        }),
        "MetricRequestCollectionService",
      ),
    },
    evaluations: {
      runs: traced(new EvaluationRunService(new NullEvaluationRunRepository()), "EvaluationRunService"),
      execution: void 0 as unknown as AppDependencies["evaluations"]["execution"],
    },
    dspySteps: { steps: new DspyStepService(new NullDspyStepRepository()) },
    simulations: { runs: SimulationRunService.create(null) },
    suiteRuns: { runs: SuiteRunService.create({ clickhouse: null, startSuiteRun: noop, queueSimulationRun: noop }) },
    organizations: nullOrganizations,
    projects: nullProjects,
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
    usageLimits: UsageLimitService.createNull(),
    commands: {
      traces: { recordSpan: noop, assignTopic: noop, recordLog: noop, recordMetric: noop, resolveOrigin: noop } satisfies AppCommands["traces"],
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
        completeExperimentRun: noop,
      } as AppCommands["experimentRuns"],
      simulations: {
        queueRun: noop,
        startRun: noop,
        messageSnapshot: noop,
        textMessageStart: noop,
        textMessageEnd: noop,
        finishRun: noop,
        deleteRun: noop,
      } as AppCommands["simulations"],
      suiteRuns: {
        startSuiteRun: noop,
        recordSuiteRunItemStarted: noop,
        completeSuiteRunItem: noop,
      } as AppCommands["suiteRuns"],
      billing: {
        reportUsageForMonth: noop,
      } as AppCommands["billing"],
    },
    ...overrides,
  });
}
