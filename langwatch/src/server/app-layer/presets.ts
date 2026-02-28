import type { PrismaClient } from "@prisma/client";
import { esClient, TRACE_INDEX, traceIndexId } from "../elasticsearch";
import { EventSourcing } from "../event-sourcing";
import { PipelineRegistry, type AppCommands } from "../event-sourcing/pipelineRegistry";
import { App, globalForApp, initializeApp } from "./app";
import { BroadcastService } from "./broadcast/broadcast.service";
import { createClickHouseClientFromConfig } from "./clients/clickhouse.factory";
import { createRedisConnectionFromConfig } from "./clients/redis.factory";
import { createAppConfigFromEnv, type AppConfig, type ProcessRole } from "./config";
import type { AppDependencies } from "./dependencies";
import { EvaluationExecutionService } from "./evaluations/evaluation-execution.service";
import { EvaluationRunService } from "./evaluations/evaluation-run.service";
import { MonitorService } from "./monitors/monitor.service";
import { OrganizationService } from "./organizations/organization.service";
import { ProjectService } from "./projects/project.service";
import { SpanStorageService } from "./traces/span-storage.service";
import { TokenizerService } from "./traces/tokenizer.service";
import { TraceSummaryService } from "./traces/trace-summary.service";
import { PlanProviderService } from "./subscription/plan-provider";
import type { SubscriptionService } from "./subscription/subscription.service";
import { EESubscriptionService } from "../../../ee/billing/services/subscription.service";
import { getSaaSPlanProvider } from "../../../ee/billing";
import { getLicenseHandler } from "../subscriptionHandler";
import { FREE_PLAN } from "../../../ee/licensing/constants";
import { createStripeClient } from "../../../ee/billing/stripe/stripeClient";
import { createSeatEventSubscriptionFns } from "../../../ee/billing/services/seatEventSubscription";
import * as subscriptionItemCalculator from "../../../ee/billing/services/subscriptionItemCalculator";
import { UsageService } from "./usage/usage.service";
import { StripeUsageReportingService } from "../../../ee/billing/services/usageReportingService";
import { meters } from "../../../ee/billing/stripe/stripePriceCatalog";

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

  const broadcast = BroadcastService.create(redis);
  const traces = {
    summary: TraceSummaryService.create(clickhouse),
    spans: SpanStorageService.create(clickhouse),
  };
  const evaluations = {
    runs: EvaluationRunService.create(clickhouse),
    execution: EvaluationExecutionService.create(prisma),
  };
  const organizations = OrganizationService.create(prisma);
  const projects = ProjectService.create(prisma);
  const usage = UsageService.create({ prisma, organizationService: organizations });

  const planProvider = config.isSaas
    ? PlanProviderService.create({
        getActivePlan: ({ organizationId, user }) =>
          getSaaSPlanProvider().getActivePlan(organizationId, user),
      })
    : PlanProviderService.create({
        getActivePlan: ({ organizationId }) =>
          getLicenseHandler().getActivePlan(organizationId),
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

  const monitors = MonitorService.create(prisma);
  const tokenizer = TokenizerService.create(config);

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
    traces,
    evaluations: { runs: evaluations.runs, execution: evaluations.execution },
    esSync: { esClient, traceIndex: TRACE_INDEX, traceIndexId },
    usageReportingService,
  });
  const commands = registry.registerAll();

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

  return initializeApp({
    config,
    broadcast,
    traces,
    evaluations,
    organizations,
    projects,
    tokenizer,
    usage,
    planProvider,
    subscription,
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
  return new App({
    config,
    broadcast: BroadcastService.create(null),
    traces: {
      summary: TraceSummaryService.create(null),
      spans: SpanStorageService.create(null),
    },
    evaluations: {
      runs: EvaluationRunService.create(null),
      execution: void 0 as unknown as AppDependencies["evaluations"]["execution"],
    },
    organizations: OrganizationService.create(null),
    projects: ProjectService.create(null),
    tokenizer: TokenizerService.create({ disableTokenization: true }),
    usage: UsageService.create({ prisma: null, organizationService: OrganizationService.create(null) }),
    planProvider: PlanProviderService.create({
      getActivePlan: async () => FREE_PLAN,
    }),
    subscription: undefined,
    commands: {
      traces: { recordSpan: noop, assignTopic: noop, assignSatisfactionScore: noop } as AppCommands["traces"],
      evaluations: {
        executeEvaluation: noop,
        startEvaluation: noop,
        completeEvaluation: noop,
      } as AppCommands["evaluations"],
      experimentRuns: {
        startExperimentRun: noop,
        recordTargetResult: noop,
        recordEvaluatorResult: noop,
        completeExperimentRun: noop,
      } as AppCommands["experimentRuns"],
      simulations: {
        startRun: noop,
        messageSnapshot: noop,
        finishRun: noop,
        deleteRun: noop,
      } as AppCommands["simulations"],
      billing: {
        reportUsageForMonth: noop,
      } as AppCommands["billing"],
    },
    ...overrides,
  });
}
