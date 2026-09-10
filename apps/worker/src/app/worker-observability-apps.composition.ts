import type { ClickHouseClient } from "@clickhouse/client";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { annotationServer } from "@langwatch/annotation-server";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { CodingAgentBillingPolicyPort } from "@langwatch/coding-agent-server";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { dataPrivacyServer } from "@langwatch/data-privacy-server";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  PostgresGovernanceAdapter,
  type PostgresGovernanceServices,
} from "@langwatch/enterprise-governance-server";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { FREE_VISIBILITY_DAYS } from "@langwatch/enterprise-licensing-contract";
import type { FoldProjectionStore } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { LogApi } from "@langwatch/log-contract";
import { logServer } from "@langwatch/log-server";
import { metricServer } from "@langwatch/metric-server";
import { modelProviderServer } from "@langwatch/model-provider-server";
import { OrganizationApi } from "@langwatch/organization-contract";
import { BroadcastAdapter } from "@langwatch/presence-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp, type ResourceScope } from "@langwatch/runtime-composition";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import {
  TraceApi,
  type TraceCanonicalisationService,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { traceServer, type TraceProcessingCommands } from "@langwatch/trace-server";
import { UserApi } from "@langwatch/user-contract";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { createWorkerCodingAgentApp } from "./worker-coding-agent-app.composition.ts";
import {
  workerEvaluationServer,
  type WorkerEvaluationInfrastructure,
} from "./worker-evaluation-server.composition.ts";
import type { WorkerEvaluationProcessing } from "./worker-evaluation-processing.composition.ts";
import type { WorkerModelProviders } from "./worker-model-provider.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import { createWorkerTelemetryReadInfrastructure } from "./worker-telemetry-read.composition.ts";
import { createWorkerTraceInfrastructure } from "./worker-trace-app.composition.ts";
import { createWorkerGithubRedis } from "./worker-github-redis.composition.ts";

export type WorkerObservabilityFoundation = Readonly<{
  projects: ProjectApi;
  organizations: OrganizationApi;
  authorization: AuthzApi;
  users: UserApi;
  retention: DataRetentionApi;
  shares: ShareApi;
  topics: TopicApi;
}>;

export type WorkerObservabilityAppsOptions = Readonly<{
  connection: PrismaConnection;
  config: WorkerConfig;
  redis: RedisConnection | null;
  storage: WorkerObjectStorage;
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  foundation: WorkerObservabilityFoundation;
  models: WorkerModelProviders;
  plans: EntitlementApi;
  featureFlags: FeatureFlagApi;
  resources: ResourceScope;
  canonicalisation: TraceCanonicalisationService;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  commands: TraceProcessingCommands;
  evaluation: WorkerEvaluationInfrastructure;
  githubSigningKey: string;
}>;

export type WorkerObservabilityApps = Readonly<{
  annotations: AnnotationApi;
  traces: TraceApi;
  dataPrivacy: DataPrivacyApi;
  logs: LogApi;
  evaluationProcessing: WorkerEvaluationProcessing;
  start(): Promise<void>;
}>;

/** Boots mutually dependent trace/review/evaluation Apps over the ready foundation. */
export async function createWorkerObservabilityApps(
  options: WorkerObservabilityAppsOptions,
): Promise<WorkerObservabilityApps> {
  const foundation = options.foundation;
  const broadcast = BroadcastAdapter.create(options.redis);
  const telemetry = createWorkerTelemetryReadInfrastructure({
    database: options.connection.client,
    config: options.config.tracePrivacy,
    resolveClickHouseClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.config.retention.defaultDays,
    resources: options.resources,
  });
  const traces = createWorkerTraceInfrastructure({
    connection: options.connection,
    resolveClickHouseClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.config.retention.defaultDays,
    canonicalisation: options.canonicalisation,
    summaryStore: options.summaryStore,
    commands: options.commands,
    broadcast,
    storage: options.storage,
    fallbackVisibilityDays: FREE_VISIBILITY_DAYS,
    processName: options.config.serviceName,
  });
  const policy = PostgresGovernanceAdapter.create({ database: options.connection.client }).build()
    .policy;
  const codingAgents = await createWorkerCodingAgentApp({
    database: options.connection.client,
    organizations: foundation.organizations,
    projects: foundation.projects,
    authorization: foundation.authorization,
    billing: new WorkerCodingAgentBilling(policy),
    clickHouse: { resolve: options.resolveClickHouseClient },
    defaultTraceRetentionDays: options.config.retention.defaultDays,
    redis: options.redis ? createWorkerGithubRedis(options.redis) : null,
    github: {
      appId: options.config.github.appId,
      privateKey: options.config.github.privateKey,
      host: options.config.github.host,
      appSlug: options.config.github.appSlug,
      webhookSecret: options.config.github.webhookSecret,
    },
    signingKey: options.githubSigningKey,
  });
  // Assigned once the runtime below has booted. The cost-rule preview reads
  // spans through this runtime's OWN trace application, and that application
  // does not exist until every module on the runtime is installed.
  let traceApp: TraceApi | undefined;
  const readSpansThrough = (): TraceApi => {
    if (!traceApp) throw new Error("The worker read spans before its trace application existed.");

    return traceApp;
  };
  const runtime = await createApp({ name: "langwatch-worker-observability" })
    .withPersistence("postgres", {
      prisma: options.connection.client,
      // The model-provider repositories are built over the deployment's own
      // cipher: the stored credential is a wire format shared between
      // processes, so it travels with the connection.
      credentials: options.models.installation.credentials,
    })
    .withInfrastructure({})
    .withProvided(ProjectApi, foundation.projects)
    .withProvided(OrganizationApi, foundation.organizations)
    .withProvided(AuthzApi, foundation.authorization)
    .withProvided(UserApi, foundation.users)
    .withProvided(DataRetentionApi, foundation.retention)
    .withProvided(ShareApi, foundation.shares)
    .withProvided(TopicApi, foundation.topics)
    .withProvided(EntitlementApi, options.plans)
    .withProvided(FeatureFlagApi, options.featureFlags)
    .withProvided(CodingAgentApi, codingAgents.app)
    .withModule(modelProviderServer, {
      infrastructure: {
        ...options.models.installation.infrastructure,
        // The cost-rule preview reads spans through this runtime's OWN trace
        // application, resolved on use rather than held: the trace module is
        // installed on this same runtime, a line below.
        spans: new WorkerModelProviderTraceSpans(readSpansThrough),
      },
    })
    .withModule(traceServer, { infrastructure: traces })
    .withModule(annotationServer)
    .withModule(dataPrivacyServer, { infrastructure: telemetry.dataPrivacy })
    .withModule(logServer, { infrastructure: telemetry.log })
    // Beside the log half and in the SAME graph: a metric point is redacted by
    // the one Data Privacy application this runtime already provides.
    .withModule(metricServer)
    .withModule(workerEvaluationServer, { infrastructure: options.evaluation })
    .withService({
      name: "worker trace broadcast",
      start: () => broadcast.start(),
      stop: () => broadcast.close(),
    })
    .boot({ role: "worker", config: { log: telemetry.logConfig } });

  traceApp = runtime.module(traceServer).provided;
  options.resources.own("worker observability feature runtime", () => runtime.stop());
  const processing = options.evaluation.processing.tryGet();
  if (!processing) {
    await runtime.stop();
    throw new Error("Evaluation feature setup did not publish its processing graph.");
  }
  return {
    annotations: runtime.module(annotationServer).provided,
    traces: runtime.module(traceServer).provided,
    dataPrivacy: runtime.module(dataPrivacyServer).provided,
    logs: runtime.module(logServer).provided,
    evaluationProcessing: processing,
    start: async () => {
      await runtime.start();
    },
  };
}

class WorkerModelProviderTraceSpans {
  #traces: () => TraceApi;
  constructor(traces: () => TraceApi) {
    this.#traces = traces;
  }

  getModelUsageStats(input: { tenantId: string; fromMs: number; limit: number }) {
    return this.#traces().readModelUsageStats({
      projectId: input.tenantId,
      fromMs: input.fromMs,
      limit: input.limit,
    });
  }

  getRecentSpansByModels(input: {
    tenantId: string;
    models: string[];
    fromMs: number;
    perModelLimit: number;
    limit: number;
  }) {
    return this.#traces().readRecentSpansByModels({
      projectId: input.tenantId,
      models: input.models,
      fromMs: input.fromMs,
      perModelLimit: input.perModelLimit,
      limit: input.limit,
    });
  }
}

class WorkerCodingAgentBilling extends CodingAgentBillingPolicyPort {
  #policy: PostgresGovernanceServices["policy"];
  constructor(policy: PostgresGovernanceServices["policy"]) {
    super();
    this.#policy = policy;
  }
  isSourceNonBillable(input: { organizationId: string; sourceType: string }): Promise<boolean> {
    return this.#policy.resolveSourceNonBillable(input);
  }
}
