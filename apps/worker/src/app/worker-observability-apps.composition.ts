import type { ClickHouseClient } from "@clickhouse/client";
import { AnnotationApi } from "@langwatch/annotation-contract";
import { annotationServer } from "@langwatch/annotation-server";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { type CodingAgentBillingPolicy } from "@langwatch/coding-agent-server";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { dataPrivacyServer } from "@langwatch/data-privacy-server";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  PostgresGovernanceAdapter,
  type PostgresGovernanceServices,
} from "@langwatch/enterprise-governance-server";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluatorApi } from "@langwatch/evaluator-contract";
import { evaluatorServer } from "@langwatch/evaluator-server";
import type { EventSourcing } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { LogApi } from "@langwatch/log-contract";
import { logServer } from "@langwatch/log-server";
import { metricServer } from "@langwatch/metric-server";
import { MonitorApi } from "@langwatch/monitor-contract";
import { monitorServer } from "@langwatch/monitor-server";
import { modelProviderServer } from "@langwatch/model-provider-server";
import { OrganizationApi } from "@langwatch/organization-contract";
import { BroadcastAdapter } from "@langwatch/presence-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp, membersFrom, type ResourceScope } from "@langwatch/runtime-composition";
import { ShareApi } from "@langwatch/share-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { traceServer } from "@langwatch/trace-server";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { resolveWorkerStoredSecretCipher } from "./worker-automation-graph.composition.ts";
import { createWorkerCodingAgentApp } from "./worker-coding-agent-app.composition.ts";
import {
  createWorkerEvaluationServer,
  type WorkerEvaluationInfrastructure,
} from "./worker-evaluation-server.composition.ts";
import type { WorkerEvaluationProcessing } from "./worker-evaluation-processing.composition.ts";
import type { WorkerModelProviders } from "./worker-model-provider.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";
import { createWorkerTelemetryReadInfrastructure } from "./worker-telemetry-read.composition.ts";
import { createWorkerGithubRedis } from "./worker-github-redis.composition.ts";

export type WorkerObservabilityFoundation = Readonly<{
  projects: ProjectApi;
  organizations: OrganizationApi;
  authorization: AuthzApi;
  apiKeys: ApiKeyApi;
  users: UserApi;
  retention: DataRetentionApi;
  shares: ShareApi;
  topics: TopicApi;
  auditLog: AuditLogApi;
}>;

export type WorkerObservabilityAppsOptions = Readonly<{
  connection: PrismaConnection;
  config: WorkerConfig;
  redis: RedisConnection | null;
  storage: WorkerObjectStorage;
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  /**
   * The process's routed query client, over the same connection the
   * resolver above dials per-tenant. Trace reads this directly; naming none
   * leaves trace to refuse at boot naming "clickhouse".
   */
  clickhouse?: ClickHouseQueryClient;
  /** The trace module's command pipeline. Absent, trace refuses at boot naming "eventing". */
  eventing?: EventSourcing;
  /**
   * The agent graph's workflow app, for the evaluator installed here. Absent,
   * evaluator refuses at boot naming workflow.
   */
  workflows?: WorkflowApi;
  foundation: WorkerObservabilityFoundation;
  models: WorkerModelProviders;
  plans: EntitlementApi;
  featureFlags: FeatureFlagApi;
  resources: ResourceScope;
  evaluation: WorkerEvaluationInfrastructure;
  githubSigningKey: string;
}>;

export type WorkerObservabilityApps = Readonly<{
  annotations: AnnotationApi;
  traces: TraceApi;
  dataPrivacy: DataPrivacyApi;
  logs: LogApi;
  monitors: MonitorApi;
  evaluators: EvaluatorApi;
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
  const policy = PostgresGovernanceAdapter.create({ database: options.connection.client }).build()
    .policy;
  const codingAgents = await createWorkerCodingAgentApp({
    database: options.connection.client,
    organizations: foundation.organizations,
    projects: foundation.projects,
    authorization: foundation.authorization,
    billing: new WorkerCodingAgentBilling(policy),
    ...(options.clickhouse ? { clickhouse: options.clickhouse } : {}),
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
  const workerEvaluationServer = createWorkerEvaluationServer(options.evaluation);
  const builder = createApp({
    role: "worker",
    config: {
      log: telemetry.logConfig,
      evaluator: {},
      /**
       * The module's schema needs the key present. `executionProxyBaseUrl`
       * stays defaulted here: this role redacts and projects, it does not
       * execute models, so the module's own refuse-by-name default is right.
       */
      "model-provider": {
        isSaas: options.config.deployment.saas,
        egress: {
          blockLocal: options.config.infrastructure.modelProvider.blockLocalHttpCalls,
          allowedHosts: options.config.infrastructure.modelProvider.allowedProxyHosts,
          verifyTls: true,
        },
        environment: options.config.infrastructure.modelProvider.environment,
      },
      /**
       * This is Trace's PROCESSING role; processName names the worker to avoid
       * duplicate registration.
       */
      trace: { processName: options.config.serviceName, registersProcessingPipeline: false },
    },
    members: membersFrom({
      prisma: options.connection.client,
      logger: createLogger(options.config.serviceName),
      encryption: resolveWorkerStoredSecretCipher(options.config),
      ...(options.clickhouse ? { clickhouse: options.clickhouse } : {}),
      ...(options.eventing ? { eventing: options.eventing } : {}),
      // model-provider declares reads("redis") for its custom-key cache.
      ...(options.redis ? { redis: options.redis } : {}),
    }),
  })
    .withProvided(ProjectApi, foundation.projects)
    .withProvided(OrganizationApi, foundation.organizations)
    .withProvided(AuthzApi, foundation.authorization)
    .withProvided(ApiKeyApi, foundation.apiKeys)
    .withProvided(UserApi, foundation.users)
    .withProvided(DataRetentionApi, foundation.retention)
    .withProvided(ShareApi, foundation.shares)
    .withProvided(TopicApi, foundation.topics)
    .withProvided(EntitlementApi, options.plans)
    .withProvided(FeatureFlagApi, options.featureFlags)
    .withProvided(CodingAgentApi, codingAgents.app)
    .withProvided(AuditLogApi, foundation.auditLog);
  if (options.workflows) builder.withProvided(WorkflowApi, options.workflows);
  const runtime = await builder
    .withModules([
      modelProviderServer,
      traceServer,
      annotationServer,
      dataPrivacyServer,
      logServer,
      // Beside the log half and in the SAME graph: a metric point is redacted
      // by the one Data Privacy application this runtime already provides.
      metricServer,
      workerEvaluationServer,
      // Monitor and evaluator ask this runtime's own peers (evaluator port,
      // trend, permissions/audit/users/models). Both still name workflows
      // (WorkflowApi), unresolved here — boot refuses naming it, the correct
      // wall until a later lane installs workflowServer beside these.
      monitorServer,
      evaluatorServer,
    ])
    .withService({
      name: "worker trace broadcast",
      start: () => broadcast.start(),
      stop: () => broadcast.close(),
    })
    .boot();

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
    monitors: runtime.module(monitorServer).provided,
    evaluators: runtime.module(evaluatorServer).provided,
    evaluationProcessing: processing,
    start: async () => {
      await runtime.start();
    },
  };
}

class WorkerCodingAgentBilling implements CodingAgentBillingPolicy {
  #policy: PostgresGovernanceServices["policy"];
  constructor(policy: PostgresGovernanceServices["policy"]) {
    this.#policy = policy;
  }
  isSourceNonBillable(input: { organizationId: string; sourceType: string }): Promise<boolean> {
    return this.#policy.resolveSourceNonBillable(input);
  }
}
