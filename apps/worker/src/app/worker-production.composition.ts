import {
  OtelProcessRetentionMetricsAdapter,
  type EventingServerRuntimeOptions,
} from "@langwatch/eventing/server";
import { BlobSweeper, type BlobSweepReport } from "@langwatch/group-queue/operational";
import {
  EnterpriseWorkerComposition,
  type EnterpriseWorkerCompositionOptions,
} from "@langwatch/enterprise-worker";
import type { Logger } from "@langwatch/observability";
import type { ProcessObservability } from "@langwatch/observability/node";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ClickHouseClient } from "@clickhouse/client";
import { LocalFeatureApis, ResourceScope } from "@langwatch/runtime-composition";
import { TraceApi } from "@langwatch/trace-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { Deferred } from "@langwatch/eventing";
import type { QueueAnnotationTracesInput } from "@langwatch/annotation-contract";
import type { TraceProcessingCommands } from "@langwatch/trace-server";
import { EventingAuthzCommandDispatcherAdapter } from "@langwatch/authz-server";
import { createWorkerFoundationApps } from "./worker-foundation-apps.composition.ts";
import { createWorkerObservabilityApps } from "./worker-observability-apps.composition.ts";
import { createWorkerGithubRedis } from "./worker-github-redis.composition.ts";
import { WorkerEvaluationProcessingResult } from "./worker-evaluation-server.composition.ts";
import {
  AgentSandboxKeyReapService,
  type PrismaApiKeyDatabase,
  PrismaApiKeyRepository,
} from "@langwatch/api-key-server";
import {
  type AuthzGrantPipelineDatabase,
  PostgresAuthzPipelineAdapter,
} from "@langwatch/authz-server";
import {
  composeGithubBranchDemand,
  composeGithubBranchMaintenance,
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "@langwatch/github-server";
import {
  type IdentityPipelineDatabase,
  type JoinRequestPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  PostgresJoinRequestPipelineAdapter,
  PostgresScimSyncPipelineAdapter,
  type PlatformOperatorPort,
  PostgresSsoConnectionPipelineAdapter,
  type SsoConnectionPipelineDatabase,
  type ScimSyncPipelineDatabase,
} from "@langwatch/identity-server";
import {
  type LangySessionKeyReapDatabase,
  OtelLangySessionKeyMetricsAdapter,
  PostgresLangySessionKeyReapAdapter,
} from "@langwatch/langy-server";
import {
  ClickHouseCodingAgentProcessingAdapter,
  createCodingAgentLogFactsDispatchSubscriber,
  createCodingAgentMetricFactsDispatchSubscriber,
} from "@langwatch/coding-agent-server";
import { CanonicalLogAdapter, ClickHouseLogProcessingAdapter } from "@langwatch/log-server";
import {
  ClickHouseMetricProcessingAdapter,
  resolveMetricCommandShardCount,
} from "@langwatch/metric-server";
import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import {
  BillableEventsQueryService,
  ClickHouseBillableEventsMeterAdapter,
  ClickHouseBillingAdapter,
  EventingBillableEventsMeterAdapter,
  EventingBillingMeterDispatchAdapter,
  EventingBillingReportingAdapter,
  ObservabilityBillingErrorAdapter,
  PostgresBillingReportingAdapter,
  PostgresBillingTenantOrganizationAdapter,
  RedisBillingOrganizationCacheAdapter,
  RedisBillingTenantOrganizationCacheAdapter,
  StripeUsageReportingAdapter,
  BillingTenantOrganizationService,
  PostgresBillingAdapter,
  PlanLimitsPlanCatalogueAdapter,
  type BillingReportingDatabase,
  type BillingTenantOrganizationDatabase,
} from "@langwatch/enterprise-billing-server";
import type { PricingModel as EntitlementPricingModel } from "@langwatch/entitlement-contract";
import { PlanNextStepService } from "@langwatch/entitlement-server";
import { PostgresOrganizationLicenseAdapter } from "@langwatch/enterprise-licensing-server";
import { ClickHouseExperimentRunProcessingAdapter } from "@langwatch/experiment-server";
import {
  type CodingAgentActivityDatabase,
  PostgresCodingAgentActivityAdapter,
  PostgresGovernanceInternalProjectAdapter,
  ProjectOldestTeamPort,
} from "@langwatch/project-server";
import { ClickHouseSuiteRunProcessingAdapter } from "@langwatch/suite-server";
import {
  TopicServerInstallerAdapter,
  type TopicClusteringDatabase,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import { TraceCanonicalisationService } from "@langwatch/trace-server";
import { ApiKeyWorkerFeatureInstaller } from "../features/api-key/api-key-worker-feature.installer.ts";
import { AuthzWorkerFeatureInstaller } from "../features/authz/authz-worker-feature.installer.ts";
import {
  WorkerAutomationNextStepAdapter,
  WorkerAutomationOrganizationPricingPort,
} from "../features/automation/automation-next-step.adapter.ts";
import { AutomationWorkerFeatureInstaller } from "../features/automation/automation-worker-feature.installer.ts";
import { BillingReportingWorkerFeatureInstaller } from "../features/billing/billing-reporting-worker-feature.installer.ts";
import { CodingAgentWorkerFeatureInstaller } from "../features/coding-agent/coding-agent-worker-feature.installer.ts";
import { EvaluationWorkerFeatureInstaller } from "../features/evaluation/evaluation-worker-feature.installer.ts";
import {
  EventingMaintenanceWorkerFeatureInstaller,
  WorkerBlobSweepPort,
} from "../features/eventing-maintenance/eventing-maintenance-worker-feature.installer.ts";
import { ExperimentWorkerFeatureInstaller } from "../features/experiment/experiment-worker-feature.installer.ts";
import { GatewaySpendWorkerFeatureInstaller } from "../features/gateway/gateway-spend-worker-feature.installer.ts";
import { LangyConversationWorkerFeatureInstaller } from "../features/langy/langy-conversation-worker-feature.installer.ts";
import { LangyMaintenanceWorkerFeatureInstaller } from "../features/langy/langy-maintenance-worker-feature.installer.ts";
import { GithubWorkerFeatureInstaller } from "../features/github/github-worker-feature.installer.ts";
import { GovernanceEventsWorkerFeatureInstaller } from "../features/governance/governance-events-worker-feature.installer.ts";
import { GovernanceIngestionWorkerFeatureInstaller } from "../features/governance/governance-ingestion-worker-feature.installer.ts";
import { LogWorkerFeatureInstaller } from "../features/log/log-worker-feature.installer.ts";
import { MetricWorkerFeatureInstaller } from "../features/metric/metric-worker-feature.installer.ts";
import { ScenarioExecutionPoolService } from "@langwatch/scenario-server";
import { SCENARIO_WORKER } from "@langwatch/scenario-contract";
import { AdminAccessService, type UsageStatsWorkerDatabase } from "@langwatch/ops-server";
import { OpsWorkerFeatureInstaller } from "../features/ops/ops-worker-feature.installer.ts";
import { GatewayRealtimeSessionWorkerFeatureInstaller } from "../features/gateway/gateway-realtime-session-worker-feature.installer.ts";
import { ScenarioExecutionWorkerFeatureInstaller } from "../features/scenario/scenario-execution-worker-feature.installer.ts";
import { ScenarioWorkerFeatureInstaller } from "../features/scenario/scenario-worker-feature.installer.ts";
import { SuiteWorkerFeatureInstaller } from "../features/suite/suite-worker-feature.installer.ts";
import { IdentityWorkerFeatureInstaller } from "../features/identity/identity-worker-feature.installer.ts";
import {
  AbsentJoinRequestMail,
  JoinRequestMailAdapter,
} from "../features/identity/join-request-mail.adapter.ts";
import { JoinRequestWorkerFeatureInstaller } from "../features/identity/join-request-worker-feature.installer.ts";
import { ScimSyncWorkerFeatureInstaller } from "../features/identity/scim-sync-worker-feature.installer.ts";
import { SsoConnectionWorkerFeatureInstaller } from "../features/identity/sso-connection-worker-feature.installer.ts";
import { TopicWorkerFeatureInstaller } from "../features/topic/topic-worker-feature.installer.ts";
import { TraceWorkerFeatureInstaller } from "../features/trace/trace-worker-feature.installer.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import {
  WorkerEventingRuntime,
  type WorkerEventingConsumerOptions,
  type WorkerEventingProductionOptions,
} from "../platform/eventing/worker-eventing.runtime.ts";
import {
  WorkerInfrastructureAdapter,
  type WorkerInfrastructureAdapterOptions,
} from "../platform/infrastructure/worker-foundation.adapter.ts";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../platform/lifecycle/worker-runtime.port.ts";
import { WorkerRuntime } from "../platform/lifecycle/worker.runtime.ts";
import type { WorkerFeatureInstallerPort } from "../features/worker-feature.installer.ts";
import { WorkerApplication } from "./worker.application.ts";
import type { DatasetContentDatabase } from "@langwatch/dataset-server/composition/dataset-content";
import {
  AutomationGraphActivityPort,
  AutomationTriggerMatchRecorderPort,
  PostgresAutomationTraceTriggerCatalogueAdapter,
  type AutomationGraphActivityDatabase,
  type AutomationTraceTriggerCatalogueDatabase,
} from "@langwatch/automation-server";
import { ExperimentEventingAdapter } from "@langwatch/experiment-server";
import {
  TraceStoredSpanReaderClickHouseRepository,
  TraceProcessingServerInstallerAdapter,
} from "@langwatch/trace-server";
import { createWorkerAnalytics } from "./worker-analytics.composition.ts";
import {
  createWorkerReportSchedule,
  createWorkerReportTraceList,
} from "./worker-report-schedule.composition.ts";
import { createWorkerGovernanceIngestion } from "./worker-governance-ingestion.composition.ts";
import {
  createWorkerAnomalyAlertTransport,
  createWorkerGovernanceAnomalySchedule,
} from "./worker-governance-anomaly.composition.ts";
import type { IngestionPullLifecycleDatabase } from "@langwatch/enterprise-governance-server";
import {
  createWorkerTopicRuntime,
  WorkerTopicAbsenceReportPort,
} from "./worker-topic-clustering.composition.ts";
import {
  tryCreateWorkerModelProviders,
  WorkerModelProviderAbsenceReportPort,
} from "./worker-model-provider.composition.ts";
import {
  createWorkerPlanProvider,
  LoggedWorkerEntitlementAbsence,
} from "./worker-plan-provider.composition.ts";
import {
  createWorkerEvaluationProcessing,
  WorkerEvaluationAbsenceReportPort,
} from "./worker-evaluation-processing.composition.ts";
import type { WorkerProjectStorageDatabase } from "./worker-object-storage.composition.ts";
import type { WorkerTraceCapabilityDatabase } from "./worker-trace-capability-services.composition.ts";
import {
  createWorkerDatasetApp,
  createWorkerDatasetNormalization,
} from "./worker-dataset-normalization.composition.ts";
import { MonitorApi } from "@langwatch/monitor-contract";
import { createWorkerMonitorApp } from "./worker-evaluation-execution.composition.ts";
import { EventingKillSwitchAdapter } from "@langwatch/feature-flag-server";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { installWorkerFeatureFlags } from "./worker-feature-flags.composition.ts";
import { createWorkerGovernanceRollups } from "./worker-governance-rollups.composition.ts";
import { createWorkerObjectStorage } from "./worker-object-storage.composition.ts";
import { createWorkerSpanStorage } from "./worker-span-storage.composition.ts";
import { WorkerCodingAgentTraceProcessingAdapter } from "../features/coding-agent/coding-agent-trace-processing.adapter.ts";
import { WorkerProjectActivityAdapter } from "./worker-project-activity.composition.ts";
import {
  tryCreateWorkerAutomationGraphComposition,
  resolveWorkerStoredSecretCipher,
  WorkerAutomationClock,
  tryCreateWorkerAutomationDelivery,
} from "./worker-automation-graph.composition.ts";
import {
  createWorkerAutomationSettlement,
  WorkerAutomationSettlementAbsenceReportPort,
} from "./worker-automation-settlement.composition.ts";
import {
  WorkerAutomationHeartbeat,
  WorkerAutomationSettlementEvaluationReader,
  WorkerAutomationSettlementTraceReader,
  WorkerTraceRecordReader,
} from "./worker-automation-settlement-reads.composition.ts";
import { createWorkerTraceSpool } from "./worker-trace-blob.composition.ts";
import { tryCreateWorkerTraceBroadcast } from "./worker-trace-broadcast.composition.ts";
import { tryCreateWorkerTenantBroadcast } from "./worker-tenant-broadcast.composition.ts";
import {
  createWorkerLangyConversation,
  WorkerLangyAbsenceReportPort,
  type WorkerLangyConversationDatabase,
} from "./worker-langy-conversation.composition.ts";
import { tryCreateWorkerLangyTitleModel } from "./worker-langy-title-model.composition.ts";
import {
  createWorkerScenarioProcessing,
  WorkerScenarioAbsenceReportPort,
} from "./worker-scenario-processing.composition.ts";
import {
  createWorkerOps,
  LoggedWorkerOpsAbsence,
  type WorkerOpsAbsenceReportPort,
} from "./worker-ops.composition.ts";
import {
  LoggedWorkerRealtimeSessionAbsence,
  tryCreateWorkerRealtimeSessionPoller,
  type WorkerRealtimeSessionAbsenceReportPort,
} from "./worker-realtime-session.composition.ts";
import {
  LoggedWorkerScenarioExecutionAbsence,
  resolveWorkerScenarioExecutionPrerequisites,
  type WorkerScenarioExecutionAbsenceReportPort,
} from "./worker-scenario-execution.composition.ts";
import { createWorkerAgentApps } from "./worker-agent-apps.composition.ts";
import { createWorkerEvaluationWorkflows } from "./worker-evaluation-app.composition.ts";
import { installWorkerEvaluator } from "./worker-evaluator.composition.ts";
import {
  createWorkerGatewaySpend,
  WorkerGatewaySpendAbsenceReportPort,
  type WorkerGatewaySpendCompositionInput,
} from "./worker-gateway-spend.composition.ts";
import {
  createWorkerWebhookDispatchRateLimiter,
  createWorkerWebhookEgress,
  createWorkerWebhookTransport,
} from "./worker-webhook-egress.composition.ts";
import { createWorkerTraceCapabilityServices } from "./worker-trace-capability-services.composition.ts";
import { createWorkerTraceProductAnalytics } from "./worker-trace-product-analytics.composition.ts";
import { createWorkerTraceProjectionStores } from "./worker-trace-projection-stores.composition.ts";
import {
  WorkerTraceProcessingPipeline,
  type WorkerTraceProcessingCommands,
} from "./worker-trace-processing-pipeline.composition.ts";
import { createWorkerTrackedEvents } from "./worker-tracked-event.composition.ts";
import {
  tryCreateWorkerMailComposition,
  type WorkerMailComposition,
} from "./worker-mail.composition.ts";

/** The worker-owned runtime dependencies for the Topic feature. */
export type WorkerTopicCompositionOptions = {
  database: TopicServerInstallerDependencies["database"];
  redis: TopicServerInstallerDependencies["redis"];
  execution: TopicServerInstallerDependencies["execution"];
  metrics: TopicServerInstallerDependencies["metrics"];
};

/**
 * Reports the composition decisions Trace's own storage would otherwise hide. A decision a
 * deployment should read in its own logs at boot rather than infer from work that quietly never
 * completes.
 */
export abstract class WorkerTraceAbsenceReportPort {
  /** No pub/sub bridge: the two broadcast subscribers register and stay inert. */
  abstract withoutBroadcast(): void;
}

/**
 * The one Prisma client this process opened. Optional only while the platform root still composes
 * this graph.
 */
export type WorkerDatabaseCompositionOptions = PrismaApiKeyDatabase &
  IngestionPullLifecycleDatabase &
  SsoConnectionPipelineDatabase &
  TopicClusteringDatabase &
  UsageStatsWorkerDatabase &
  AuthzGrantPipelineDatabase &
  AutomationGraphActivityDatabase &
  AutomationTraceTriggerCatalogueDatabase &
  BillingReportingDatabase &
  BillingTenantOrganizationDatabase &
  CodingAgentActivityDatabase &
  DatasetContentDatabase &
  PrismaGithubInstallationsDatabase &
  PrismaGithubPullRequestsDatabase &
  IdentityPipelineDatabase &
  JoinRequestPipelineDatabase &
  LangySessionKeyReapDatabase &
  WorkerLangyConversationDatabase &
  ScimSyncPipelineDatabase &
  WorkerProjectStorageDatabase &
  WorkerTraceCapabilityDatabase;

/**
 * The other three — `identity`, `scim-sync` and `join-requests` — are composed below from
 * `@langwatch/identity-server`'s Postgres seams,
 * The ONE identity ledger this graph still RECEIVES (ADR-101).
 */
export abstract class WorkerGithubAbsenceReportPort {
  abstract withoutAppCredentials(): void;
}

/** Resolved technical inputs for the Worker-owned transport foundation. */
export type WorkerInfrastructureCompositionOptions = Omit<
  WorkerInfrastructureAdapterOptions,
  "resources"
>;

/**
 * Consumer ownership, stated alongside the Eventing ports it applies to.
 */
type WorkerEventingConsumerCompositionOptions = {
  consumers?: WorkerEventingConsumerOptions;
  /**
   * Every configured ClickHouse endpoint, shared and private alike. The tenant-keyed resolver
   * beside it answers "the client for THIS tenant", which is the only question a fold or an append
   * may ask.
   */
  resolveClickHouseInstances?: WorkerGatewaySpendCompositionInput["resolveClickHouseInstances"];
  /**
   * One ORGANIZATION's endpoint, with no directory lookup. The anonymous usage report counts an
   * organization's projects together and already holds the organization, so routing through a
   * project id would be a lookup to arrive back where it started.
   */
  resolveClickHouseOrganizationClient?: (organizationId: string) => unknown;
};

type WorkerProductionCompositionBaseOptions = {
  config: WorkerConfig;
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  /** The one Prisma client this process opened. */
  database: WorkerDatabaseCompositionOptions;
  /**
   * The SAME client, as the typed connection the tenancy graph needs.
   */
  connection?: PrismaConnection;
  featureClickHouse?: {
    resolveClient: (tenantId: string) => Promise<ClickHouseClient>;
    eventLogClient: () => ClickHouseClient;
  };
  /**
   * Pipeline groups whose features have moved out of the legacy registry. Each stays optional until
   * every group in Wave 4 has landed: the shared `event-sourcing/jobs` queue still belongs to the
   * legacy worker, so an incomplete graph must be composable without pretending to be complete.
   */
  enterprise?: EnterpriseWorkerCompositionOptions;
  observability?: ProcessObservability;
};

/** All process boundaries are supplied explicitly by the executable's boot root. */
export type WorkerProductionCompositionOptions =
  | (WorkerProductionCompositionBaseOptions & {
      /** Constructs the process-owned Redis/AWS/storage foundation. */
      eventing: Omit<EventingServerRuntimeOptions, "groupQueue" | "consumersEnabled"> &
        WorkerEventingConsumerCompositionOptions;
      infrastructure: WorkerInfrastructureCompositionOptions;
      resources: ResourceScope;
    })
  | (WorkerProductionCompositionBaseOptions & {
      /** Compatibility path for already-composed technical test ports. */
      eventing: Omit<EventingServerRuntimeOptions, "consumersEnabled"> &
        WorkerEventingConsumerCompositionOptions;
      infrastructure?: undefined;
      resources?: ResourceScope;
    });

/**
 * Fully composed background-worker graph for extractable worker surfaces. The shared Eventing
 * consumer is off unless the caller asks for it.
 */
export class WorkerProductionComposition {
  static async create(
    options: WorkerProductionCompositionOptions,
  ): Promise<WorkerProductionComposition> {
    const infrastructure = options.infrastructure
      ? WorkerInfrastructureAdapter.create({
          ...options.infrastructure,
          resources: options.resources,
        })
      : undefined;
    const eventingOptions = createEventingPersistence(options, infrastructure);
    // The one Redis this process opened, named once. A worker that composed its own foundation has
    // it there; one handed an already-built substrate reads the queue's. They are the same
    // connection either way, and naming it once is what stops a feature reaching for a second: two
    // connections would give one process two fold caches, two dedup keyspaces and two tenant
    // broadcast channels.
    const processRedis = infrastructure?.redis ?? eventingOptions.groupQueue.redis;
    const mail = tryCreateWorkerMailComposition({
      config: options.config,
      ...(infrastructure ? { aws: infrastructure.aws } : {}),
      ...(options.resources ? { resources: options.resources } : {}),
    });
    // One fenced outbound sender for the whole process: an automation's webhook alert and a webhook
    // endpoint's delivery count against the same ceiling and answer to the same address policy. The
    // counter is composed BESIDE the sender rather than inside it, because a third outbound hop
    // does not pass through the sender at all: a webhook endpoint that delivers to a queue is put
    // on that queue directly.
    const webhookDispatchRateLimiter = createWorkerWebhookDispatchRateLimiter({
      config: options.config,
      redis: eventingOptions.groupQueue.redis,
    });
    const webhookEgress = createWorkerWebhookEgress({
      config: options.config,
      redis: eventingOptions.groupQueue.redis,
      rateLimiter: webhookDispatchRateLimiter,
    });
    WorkerProductionComposition.requireMailForConsumers({
      mail,
      consumers: options.eventing.consumers,
      resources: options.resources,
    });

    // The SaaS billable-events meter and the dispatch subscriber that follows it, built HERE rather
    // than received. They are configured on the runtime itself rather than on a pipeline, because
    // their `global:*` queues join the shared job registry the moment the first pipeline registers
    // — so the pair has to exist before any feature mounts, and the sender its subscriber calls is
    // produced by a pipeline this same composition registers afterwards.
    const billingReportingInstallerHolder: {
      current: BillingReportingWorkerFeatureInstaller | undefined;
    } = { current: undefined };
    const saasMeter = options.config.deployment.saas
      ? saasBillableEventsMeter({
          database: options.database,
          redis: eventingOptions.groupQueue.redis,
          resolveClickHouseClient: options.eventing.resolveClickHouseClient,
          getDispatch: () => {
            if (!billingReportingInstallerHolder.current) {
              throw new Error(
                "SaaS billable-events metering is composed without the billing reporting pipeline; the meter has no sender.",
              );
            }
            return billingReportingInstallerHolder.current.commands.reportUsageForMonth;
          },
        })
      : undefined;

    // The flag answer, handed out before the feature is installed. The Eventing
    // runtime below reads it, the foundation apps are composed over that
    // runtime, and a tenant-targeted flag read is authorized against the
    // directories those apps boot — so the reference is what lets one order
    // exist. ONE per process, which is what keeps the cache tier shared and two
    // callers from disagreeing for a TTL about whether a switch is thrown.
    const featureFlagApis = new LocalFeatureApis();
    featureFlagApis.declare(FeatureFlagApi);
    const featureFlags = featureFlagApis.reference(FeatureFlagApi);

    const eventing = WorkerEventingRuntime.createProduction({
      persistence: eventingOptions,
      warnWhenProjectionsRunInline: options.config.nodeEnvironment === "production",
      killSwitch: EventingKillSwitchAdapter.create(featureFlags),
      ...(saasMeter ? { configureGlobalProjections: saasMeter } : {}),
      ...(options.eventing.consumers ? { consumers: options.eventing.consumers } : {}),
    });
    // Unconditional, like every other substrate sweep below: both halves are composed from this
    // package over objects this process already holds.
    const eventingMaintenance = EventingMaintenanceWorkerFeatureInstaller.create({
      eventing,
      blobSweep: WorkerGroupQueueBlobSweep.create(eventingOptions.groupQueue.redis),
      retentionMetrics: OtelProcessRetentionMetricsAdapter.create(),
    });
    // Unconditional, unlike the groups still owned by the legacy registry: the
    // sweep is composed from this package and the feature's own service, so
    // there is no graph in which it is present but unbuildable. The metrics
    // adapter is the feature's own because this process has no prom-client
    // registry to lend it; it writes the same series name the App writes.
    const langyMaintenance = LangyMaintenanceWorkerFeatureInstaller.create({
      eventing,
      sessionKeyReap: PostgresLangySessionKeyReapAdapter.create({
        database: options.database,
        metrics: OtelLangySessionKeyMetricsAdapter.create(),
      }).build(),
    });
    // Unconditional, unlike the groups still owned by the legacy registry: the
    // sweep is composed from this package and the feature's own service, so
    // there is no graph in which it is present but unbuildable.
    const apiKey = ApiKeyWorkerFeatureInstaller.create({
      eventing,
      sandboxKeyReap: AgentSandboxKeyReapService.create({
        repository: PrismaApiKeyRepository.create({ prisma: options.database }),
      }),
    });
    // Stateless derivation over one span or log record: it reads nothing and
    // holds nothing, so this graph builds its own rather than taking the App's.
    // One instance, because the coding-agent fold and the Log pipeline's
    // dispatch subscriber ask it the same questions.
    const traceCanonicalisation = TraceCanonicalisationService.create();
    // Unconditional, on the same footing as the API-key sweep: the sweep is composed from this
    // package and the feature's own service, so there is no graph in which it is present but
    // unbuildable. Credentials are a different question from composition — without them the recheck
    // half asks GitHub nothing and the retention half keeps working — so their absence is reported
    // by name rather than silently mounting a half-sweep.
    const githubConfig = options.config.github;
    if (!githubConfig.appId || !githubConfig.privateKey) {
      WorkerProductionComposition.githubAbsence(options)?.withoutAppCredentials();
    }
    const githubRedis = createWorkerGithubRedis(processRedis);
    const github = GithubWorkerFeatureInstaller.create({
      eventing,
      branchMaintenance: composeGithubBranchMaintenance({
        repositories: {
          installations: PrismaGithubInstallationsRepository.create(options.database),
          pullRequests: PrismaGithubPullRequestsRepository.create(options.database),
        },
        config: {
          appId: githubConfig.appId ?? "",
          privateKey: githubConfig.privateKey ?? "",
        },
        redis: githubRedis,
        ...(githubConfig.host ? { hostConfig: { host: githubConfig.host } } : {}),
      }),
    });
    // Unconditional, on the same footing as the sweeps above: every dependency is composed from a
    // feature package over substrates this process already holds — the tenant-keyed ClickHouse
    // client the event store resolves through, the queue's own Redis, and the one Prisma client
    // this process opened. So there is no graph in which it is present but unbuildable.
    const codingAgentActivity = PostgresCodingAgentActivityAdapter.create({
      database: options.database,
    }).build();
    const projectActivity = WorkerProjectActivityAdapter.create(codingAgentActivity);
    const codingAgent = CodingAgentWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseCodingAgentProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        redis: eventingOptions.groupQueue.redis,
        traceCanonicalisation,
        projectActivity,
        pullRequestMapping: composeGithubBranchDemand({
          repositories: {
            installations: PrismaGithubInstallationsRepository.create(options.database),
            pullRequests: PrismaGithubPullRequestsRepository.create(options.database),
          },
          config: {
            appId: githubConfig.appId ?? "",
            privateKey: githubConfig.privateKey ?? "",
          },
          redis: githubRedis,
          ...(githubConfig.host ? { hostConfig: { host: githubConfig.host } } : {}),
          project: projectActivity,
        }),
        ...(options.config.eventing.foldCacheTtlSeconds === undefined
          ? {}
          : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      }),
    });
    // The Gateway spend spine and the Governance signal log, composed here rather than received,
    // and composed as ONE pair. UNCONDITIONAL, on the same footing as every other pipeline this
    // process now owns: ten of the shared registry's routing keys are theirs, and a consumer that
    // claimed `event-sourcing/jobs` without them would leave every spend command, every budget
    // debit and every webhook delivery redelivering forever while the pods stayed up.
    const plans = options.connection
      ? createWorkerPlanProvider({
          isSaas: options.config.deployment.saas,
          subscriptions: PostgresBillingAdapter.create(options.connection.client).build()
            .subscriptions,
          // The licence row a self-hosted deployment's Enterprise tier lives
          // in, on the same guarded client. Without it this process refuses
          // the webhook batch a licensed customer's screen says is enabled.
          licenses: PostgresOrganizationLicenseAdapter.create(options.connection.client).build(),
          ...(options.config.deployment.licensePublicKey
            ? { licensePublicKey: options.config.deployment.licensePublicKey }
            : {}),
          ...(options.observability
            ? { report: LoggedWorkerEntitlementAbsence.create(options.observability.logger) }
            : {}),
        })
      : undefined;
    const gatewayAbsence = WorkerProductionComposition.gatewayAbsence(options);
    // The spend-spike evaluator rides this installer, unconditionally, because every collaborator
    // it needs is one this process already holds: the Prisma client its rules and alerts live in,
    // the tenant-keyed ClickHouse client the `governance_kpis` windows are read from, and the same
    // address fence every other customer-supplied destination in this process leaves through.
    const governanceEventsInstaller = GovernanceEventsWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => gatewaySpendGraph.governance.buildProcessing() },
      eventing,
      anomalySchedule: createWorkerGovernanceAnomalySchedule({
        database: options.database,
        resolveClickHouseClient: options.eventing.resolveClickHouseClient,
        transport: createWorkerAnomalyAlertTransport(options.config),
      }),
    });
    const gatewaySpendGraph = createWorkerGatewaySpend({
      config: options.config,
      database: options.database as never,
      resolveClickHouseClient: options.eventing.resolveClickHouseClient,
      ...(options.eventing.resolveClickHouseInstances
        ? { resolveClickHouseInstances: options.eventing.resolveClickHouseInstances }
        : {}),
      redis: eventingOptions.groupQueue.redis,
      ...(options.config.eventing.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      processStore: eventing.processStore,
      egress: webhookEgress,
      dispatchRateLimiter: webhookDispatchRateLimiter,
      ...(infrastructure ? { awsClientConfig: (input) => infrastructure.aws.build(input) } : {}),
      governanceCommands: {
        recordVkLifecycle: (data) => governanceEventsInstaller.commands.recordVkLifecycle(data),
        recordBudgetCrossing: (data) =>
          governanceEventsInstaller.commands.recordBudgetCrossing(data),
      },
      ...(plans ? { plans } : {}),
      ...(gatewayAbsence ? { absence: gatewayAbsence } : {}),
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    const governanceEvents = governanceEventsInstaller;
    const gatewaySpend = GatewaySpendWorkerFeatureInstaller.create({
      installer: gatewaySpendGraph.spend,
      eventing,
    });
    // Brokered voice, settled without the customer's webhook. Composed beside
    // the spend pipeline because it confirms through that pipeline's own
    // `confirmSpend`, and installed after it for the same reason.
    const realtimeSessionPoller = tryCreateWorkerRealtimeSessionPoller({
      database: options.connection?.client,
      encryptionKey: options.config.automation.credentialsEncryptionKey,
      spendConfirmation: gatewaySpend.spendConfirmation,
      ...(WorkerProductionComposition.realtimeSessionAbsence(options)
        ? { absence: WorkerProductionComposition.realtimeSessionAbsence(options)! }
        : {}),
    });
    const gatewayRealtimeSession = realtimeSessionPoller
      ? GatewayRealtimeSessionWorkerFeatureInstaller.create({ poller: realtimeSessionPoller })
      : undefined;
    // Unconditional, on the same footing as the sweeps above: both pipelines are composed from
    // their own feature package over the tenant-keyed ClickHouse client this graph already resolves
    // its event store through, so there is no graph in which they are present but unbuildable.
    const metric = MetricWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseMetricProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        metricCommandShardCount: resolveMetricCommandShardCount(
          options.config.processing.metricShards,
        ),
      }),
      subscribers: [
        createCodingAgentMetricFactsDispatchSubscriber({
          contributeMetricFacts: codingAgent.commands.contributeMetricFacts,
        }),
      ],
    });
    const log = LogWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseLogProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        logCommandShardCount: CanonicalLogAdapter.resolveLogCommandShardCount(
          options.config.processing.logShards,
        ),
      }),
      subscribers: [
        createCodingAgentLogFactsDispatchSubscriber({
          contributeLogFacts: codingAgent.commands.contributeLogFacts,
          traceCanonicalisation,
        }),
      ],
    });
    // Unconditional, on the same footing as metric and log: the pipeline is composed from its own
    // feature package over the tenant-keyed ClickHouse client this graph already resolves its event
    // store through, so there is no graph in which it is present but unbuildable.
    const suite = SuiteWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseSuiteRunProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        redis: eventingOptions.groupQueue.redis,
        ...(options.config.eventing.foldCacheTtlSeconds === undefined
          ? {}
          : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      }),
    });
    // Unconditional, on the same footing as suite above: the pipeline is composed from its own
    // feature package over the tenant-keyed ClickHouse client this graph already resolves its event
    // store through, so there is no graph in which it is present but unbuildable.
    const experiment = ExperimentWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseExperimentRunProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        redis: eventingOptions.groupQueue.redis,
        ...(options.config.eventing.foldCacheTtlSeconds === undefined
          ? {}
          : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      }),
    });
    // TRACE, COMPOSED HERE RATHER THAN RECEIVED. This is the conversion the step-(g) attempt halted
    // on: the pipeline definition, `command:recordSpan` and all fifteen subscriber handlers are now
    // built from substrates this process holds — the one Prisma client, the queue's Redis, the
    // tenant-keyed ClickHouse client, this deployment's own variables and its object storage — plus
    // the command proxies the sibling installers publish above.
    const traceDatabase = options.database;
    const traceAbsence = WorkerProductionComposition.traceAbsence(options);
    const objectStorage = createWorkerObjectStorage({
      config: options.config,
      database: traceDatabase,
      ...(options.resources ? { resources: options.resources } : {}),
    });
    // The privacy resolution the record path redacts by, held as a reference:
    // the Data Privacy application boots with the observability half further
    // down, and this is where the record path is built. Bound the moment that
    // half returns; a call before then refuses by name rather than answering
    // off a second resolution.
    const dataPrivacyApis = new LocalFeatureApis();
    dataPrivacyApis.declare(DataPrivacyApi);
    options.resources?.own("worker record-path data privacy peer", () => dataPrivacyApis.close());
    // The monitor application installs below, over the grants graph the tenant
    // half opens. Bound the moment it does; a listing asked for before then
    // refuses by name rather than answering off a second reading.
    const monitorApis = new LocalFeatureApis();
    monitorApis.declare(MonitorApi);
    options.resources?.own("worker record-path monitor peer", () => monitorApis.close());
    const traceServices = createWorkerTraceCapabilityServices({
      database: traceDatabase,
      dataPrivacy: dataPrivacyApis.reference(DataPrivacyApi),
      monitors: monitorApis.reference(MonitorApi),
    });
    // ONE publisher, three producers. Trace, Langy and Scenario all advance
    // projections a tenant's tabs are watching, and all three publish the same
    // object onto the same channel — so the process composes the publisher once
    // and each feature receives it through its own narrow port. Two publishers
    // over two connections would be two wire formats to keep aligned.
    const tenantBroadcast = tryCreateWorkerTenantBroadcast({
      redis: processRedis,
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    const langyAbsence = WorkerProductionComposition.langyAbsence(options);
    const traceBroadcast = tenantBroadcast
      ? tryCreateWorkerTraceBroadcast({
          redis: processRedis,
          broadcast: tenantBroadcast,
          ...(options.observability ? { logger: options.observability.logger } : {}),
        })
      : undefined;
    if (!traceBroadcast) traceAbsence?.withoutBroadcast();
    // Allocate the cyclic foundation APIs before their factories retain peer clients.
    const authzDispatcher = EventingAuthzCommandDispatcherAdapter.create();
    const topicRequest = new Deferred<
      (input: {
        tenantId: string;
        occurredAt: number;
        trigger: "manual";
        requestedByUserId: string;
      }) => Promise<void>
    >("worker.topic.requestClustering");
    const foundation =
      options.connection && options.featureClickHouse && plans && options.resources
        ? await createWorkerFoundationApps({
            connection: options.connection,
            config: options.config,
            redis: processRedis,
            storage: objectStorage,
            eventing,
            clickhouse: options.featureClickHouse,
            plans,
            featureFlags,
            resources: options.resources,
            authzDispatcher,
            topicClustering: { requestClustering: topicRequest.fn },
          })
        : void 0;
    const tenancy = foundation?.tenancy;
    // The rollout flags, installed now that the three directories a
    // tenant-targeted read is authorized against are open, and bound to the
    // reference every half above already holds. Every flag read before this
    // line refuses by name rather than answering a default.
    if (options.connection && tenancy) {
      featureFlagApis.bind(
        FeatureFlagApi,
        await installWorkerFeatureFlags({
          prisma: options.connection.client,
          config: options.config,
          redis: eventingOptions.groupQueue.redis,
          peers: {
            permissions: tenancy.authorization,
            projects: tenancy.projects,
            organizations: tenancy.organizations,
          },
        }),
      );
      featureFlagApis.ready();
      options.resources?.own("worker feature-flag clients", () => featureFlagApis.close());
    }
    // The model gateway, composed once for every path in this process that resolves a customer's
    // model: topic clustering's four questions and an online evaluation's `X_LITELLM_*`
    // environment. Two gateways would be two decryptions of one stored credential and two answers
    // to which model a project clusters with, so it is built here and handed down.
    const modelProviders = tryCreateWorkerModelProviders({
      config: options.config,
      database: options.database,
      redis: processRedis,
      encryption: options.config.automation.credentialsEncryptionKey
        ? resolveWorkerStoredSecretCipher(options.config)
        : undefined,
      // A provider row's scope is the triple project/team/organization and its
      // reads are authorized, so the gateway takes the whole tenancy graph
      // rather than three services it could be handed from three compositions.
      // Absent only where this process opened no client at all, which is the
      // one shape `withoutModelGateway("no-tenancy")` still names.
      tenancy,
      ...(WorkerProductionComposition.modelProviderAbsence(options)
        ? { absence: WorkerProductionComposition.modelProviderAbsence(options)! }
        : {}),
    });
    // Which model a conversation's title is written by, over that same
    // gateway. `undefined` where the gateway, the project directory or the
    // execution proxy is missing, and Langy's own absence report says so at
    // boot rather than one warning per conversation.
    const langyTitleModels = tryCreateWorkerLangyTitleModel({
      modelProviders: modelProviders?.modelProviders,
      // The READ half of Project, which is the whole of what a model cascade
      // asks of a project directory — the wide `ProjectApi` the tenancy
      // graph now composes satisfies the same reads, and this path deliberately
      // asks for no more than it uses.
      projects: traceServices.projects,
      nlpServiceUrl: options.config.infrastructure.modelProvider.nlpServiceUrl,
    });
    // Langy's conversation pipeline, composed here rather than received. UNCONDITIONAL, on the same
    // footing as trace processing: the pipeline owns twenty-four of the shared registry's routing
    // keys, its two operational folds are Postgres, and there is no deployment in which those keys
    // are meaningless.
    const langyConversation = LangyConversationWorkerFeatureInstaller.create({
      installer: createWorkerLangyConversation({
        config: options.config,
        database: traceDatabase,
        redis: eventingOptions.groupQueue.redis,
        resolveClickHouseClient: options.eventing.resolveClickHouseClient as unknown as Parameters<
          typeof createWorkerLangyConversation
        >[0]["resolveClickHouseClient"],
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        ...(tenantBroadcast ? { broadcast: tenantBroadcast } : {}),
        ...(langyTitleModels ? { titleModels: langyTitleModels } : {}),
        ...(langyAbsence ? { absence: langyAbsence } : {}),
        ...(options.observability ? { logger: options.observability.logger } : {}),
      }),
      eventing,
    });
    const trackedEvents = createWorkerTrackedEvents({
      redis: eventingOptions.groupQueue.redis,
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    const traceStores = createWorkerTraceProjectionStores({
      resolveClickHouseClient: options.eventing.resolveClickHouseClient,
      defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
      redis: eventingOptions.groupQueue.redis,
      ...(options.config.eventing.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
    });
    // The simulation-run pipeline, composed here rather than received. It is built AFTER the trace
    // projection stores because its metrics command reads the trace summary fold this process
    // already composes — one store, one cache prefix, one applied-event-id set. Install ORDER is
    // unchanged and still lives in `orderedFeatureInstallers`: Suite registers before Scenario
    // because the simulation process reports item starts and completions into a suite run.
    const scenarioAbsence = WorkerProductionComposition.scenarioAbsence(options);
    // Whether this pod can RUN a simulation, decided before the pipeline is
    // built so the pool and the boot report cannot disagree. The pool is the
    // only piece created here: everything it needs is built after the pipeline
    // publishes the simulation service its failure handler finishes runs
    // through.
    const scenarioExecutionPrerequisites = resolveWorkerScenarioExecutionPrerequisites({
      config: options.config,
      connection: options.connection,
      modelProviders: modelProviders?.modelProviders,
      projects: tenancy?.projects,
      redis: eventingOptions.groupQueue.redis,
      resolveClickHouseClient: options.eventing.resolveClickHouseClient,
      defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
      // The SAME object storage the trace claim check writes through: a staged
      // invoke body belongs in the tenant's own bucket, not a second one.
      payloadStaging: objectStorage.payloadStaging,
      ...(WorkerProductionComposition.scenarioExecutionAbsence(options)
        ? { absence: WorkerProductionComposition.scenarioExecutionAbsence(options)! }
        : {}),
    });
    const scenarioExecutionPool = scenarioExecutionPrerequisites
      ? ScenarioExecutionPoolService.create({ concurrency: SCENARIO_WORKER.CONCURRENCY })
      : undefined;
    const scenarioProcessing = createWorkerScenarioProcessing({
      resolveClickHouseClient: options.eventing.resolveClickHouseClient,
      defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
      redis: eventingOptions.groupQueue.redis,
      ...(options.config.eventing.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      traceSummaryStore: traceStores.traceSummaryStore,
      eventStore: eventing.eventStore,
      ...(tenantBroadcast ? { broadcast: tenantBroadcast } : {}),
      suiteRuns: {
        recordSuiteRunItemStarted: (data) => suite.commands.recordSuiteRunItemStarted(data),
        completeSuiteRunItem: (data) => suite.commands.completeSuiteRunItem(data),
      },
      ...(scenarioExecutionPool ? { executionPool: scenarioExecutionPool } : {}),
      ...(scenarioAbsence ? { absence: scenarioAbsence } : {}),
    });
    const scenario = ScenarioWorkerFeatureInstaller.create({
      installer: scenarioProcessing,
      eventing,
    });
    const agentTracePeers = new LocalFeatureApis();
    agentTracePeers.declare(TraceApi);
    options.resources?.own("worker scenario trace peer", () => agentTracePeers.close());
    if (
      scenarioExecutionPrerequisites &&
      (!foundation || !options.featureClickHouse || !options.resources)
    ) {
      throw new Error("Scenario execution requires the worker feature foundation and lifecycle.");
    }
    const agentApps =
      scenarioExecutionPrerequisites &&
      scenarioExecutionPool &&
      foundation &&
      options.featureClickHouse &&
      options.resources
        ? await createWorkerAgentApps({
            prerequisites: scenarioExecutionPrerequisites,
            foundation,
            traces: agentTracePeers.reference(TraceApi),
            pool: scenarioExecutionPool,
            simulations: scenarioProcessing.simulations,
            resolveClickHouseClient: options.featureClickHouse.resolveClient,
            resources: options.resources,
          })
        : void 0;
    const scenarioExecution = agentApps
      ? ScenarioExecutionWorkerFeatureInstaller.create({ processor: agentApps.processor })
      : void 0;
    // The three operational loops: the enqueue-rate tick, the anonymous daily
    // usage report and the ClickHouse storage gauges. Composed here because
    // all three read substrates this graph already holds, and installed as one
    // feature because a process either owns the operational surface or does
    // not.
    const ops = createWorkerOps({
      config: options.config,
      database: options.database,
      redis: processRedis,
      featureFlags,
      resolveOrganizationClient: options.eventing.resolveClickHouseOrganizationClient as never,
      resolveClickHouseInstances: options.eventing.resolveClickHouseInstances as never,
      ...(WorkerProductionComposition.opsAbsence(options)
        ? { absence: WorkerProductionComposition.opsAbsence(options)! }
        : {}),
    });
    const opsWorkers = OpsWorkerFeatureInstaller.create({
      workers: ops.workers,
      storageStats: ops.storageStats,
    });
    // Automation's two halves, sharing one set of transports and one set of
    // ceilings. Absent exactly when this deployment named no `BASE_HOST`: every
    // alert and every digest carries links back to the deployment and a sender
    // address derived from the same host, so a vertical composed without one
    // would decide correctly and then send mail nobody can act on.
    const automationDelivery = tryCreateWorkerAutomationDelivery({
      config: options.config,
      mail,
      webhookTransport: createWorkerWebhookTransport({
        config: options.config,
        egress: webhookEgress,
        redis: eventingOptions.groupQueue.redis,
      }),
      redis: processRedis,
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    // The graph-alert vertical `subscriber:graphTriggerActivity` re-evaluates
    // through.
    const graphActivity =
      mail && automationDelivery
        ? tryCreateWorkerAutomationGraphComposition({
            config: options.config,
            delivery: automationDelivery,
            prisma: traceDatabase,
            mail,
            dependencies: {
              projects: traceServices.projects,
              analytics: createWorkerAnalytics({
                // The deployment's real ClickHouse client, which `@langwatch/eventing`
                // narrows to the two methods its event store uses and Analytics has
                // not been narrowed to. The composition root is the one place that
                // holds both shapes of the same object.
                resolveClickHouseClient: options.eventing
                  .resolveClickHouseClient as unknown as Parameters<
                  typeof createWorkerAnalytics
                >[0]["resolveClickHouseClient"],
                defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
              }),
            },
            redis: processRedis,
            ...(options.observability ? { logger: options.observability.logger } : {}),
          })
        : undefined;
    // Automation's settlement half, composed here rather than received. UNCONDITIONAL, and it
    // installs FIRST: `command:recordTriggerMatch` is the durable write every trigger match from
    // trace, evaluation and governance lands in, and `subscriber:pm:triggerSettlement` is what
    // turns those matches into one notification per window. A consumer that claimed `event-
    // sourcing/jobs` without the pair would leave every match redelivering forever.
    const automationAbsence = WorkerProductionComposition.automationAbsence(options);
    // The full trace record, and the dataset append that consumes it. ONE gate for both, and it is
    // the typed Prisma client: the packaged legacy read declares the generated client by type, and
    // so does Dataset's Postgres adapter.
    const traceRecords =
      options.connection && plans && tenancy
        ? WorkerTraceRecordReader.create({
            connection: options.connection,
            resolveClickHouseClient: options.eventing
              .resolveClickHouseClient as unknown as Parameters<
              typeof WorkerTraceRecordReader.create
            >[0]["resolveClickHouseClient"],
            dataPrivacy: traceServices.dataPrivacy,
            plans,
            projects: tenancy.projects,
            traceCanonicalisation,
            ...(options.observability ? { logger: options.observability.logger } : {}),
          })
        : undefined;
    // The ONE dataset application this process installs. Both halves that
    // reach a dataset read it: the automation append below, and the studio
    // datasets an evaluation run materialises.
    const datasets =
      options.connection && options.resources
        ? await createWorkerDatasetApp({
            database: options.connection.client,
            storage: objectStorage,
            resources: options.resources,
          })
        : undefined;
    const automationDatasets = traceRecords ? datasets : undefined;
    // The ONE monitor application this process installs, for the monitor a
    // queued evaluation command names.
    const monitors =
      options.connection && options.resources && tenancy
        ? await createWorkerMonitorApp({
            database: options.connection.client,
            permissions: tenancy.authorization,
            resources: options.resources,
          })
        : undefined;
    if (monitors) {
      monitorApis.bind(MonitorApi, monitors);
      monitorApis.ready();
    }
    // Boot connects annotation dispatch before settlement consumes jobs.
    const annotationQueueDispatch = new Deferred<
      (input: QueueAnnotationTracesInput) => Promise<void>
    >("worker.annotation.queueTraces");
    const automationAnnotations =
      foundation && modelProviders ? { queueTraces: annotationQueueDispatch.fn } : void 0;
    // ONE trace reader for both halves of this process's Automation work.
    // The settlement digest and Evaluation's alert subscriber ask it the same
    // two questions — a trace's summary and whether a saved filter reads
    // evaluations — and two readers would give one process two answers to the
    // second, which is what decides whether an alert fires at all.
    const settlementTraceReader = WorkerAutomationSettlementTraceReader.create({
      traceSummaryStore: traceStores.traceSummaryStore,
      resolveClickHouseClient: options.eventing.resolveClickHouseClient as unknown as Parameters<
        typeof WorkerAutomationSettlementTraceReader.create
      >[0]["resolveClickHouseClient"],
      ...(traceRecords ? { records: traceRecords } : {}),
      ...(automationAbsence ? { absence: automationAbsence } : {}),
    });
    const automationClock = new WorkerAutomationClock();
    // Composed exactly when this process holds the typed client the calendar row lives in AND can
    // send: a report that came due on a process with no mail would claim its slot, render its data
    // and deliver nothing, which is strictly worse than a slot nobody claimed — the lease settles,
    // the calendar advances, and the period it summarised is gone.
    // ADR-044 Phase 3c: the scheduled-report calendar.
    const reportSchedule =
      options.connection && mail && automationDelivery
        ? createWorkerReportSchedule({
            connection: options.connection,
            clock: automationClock,
            delivery: automationDelivery,
            projects: traceServices.projects,
            analytics: createWorkerAnalytics({
              resolveClickHouseClient: options.eventing
                .resolveClickHouseClient as unknown as Parameters<
                typeof createWorkerAnalytics
              >[0]["resolveClickHouseClient"],
              defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
            }),
            traces: createWorkerReportTraceList({
              resolveClickHouseClient: options.eventing
                .resolveClickHouseClient as unknown as Parameters<
                typeof createWorkerReportTraceList
              >[0]["resolveClickHouseClient"],
              defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
              baseHost: mail.baseHost,
            }),
            baseHost: mail.baseHost,
            redis: processRedis,
            ...(options.observability ? { logger: options.observability.logger } : {}),
          })
        : undefined;
    const automation = AutomationWorkerFeatureInstaller.create({
      installer: createWorkerAutomationSettlement({
        config: options.config,
        prisma: traceDatabase,
        clock: automationClock,
        ...(mail && automationDelivery
          ? { notifications: { ...automationDelivery, baseHost: mail.baseHost } }
          : {}),
        projects: traceServices.projects,
        traces: settlementTraceReader,
        ...(automationDatasets ? { datasets: automationDatasets } : {}),
        ...(automationAnnotations ? { annotations: automationAnnotations } : {}),
        ...(plans && tenancy ? { plans: { plans, projects: tenancy.projects } } : {}),
        // Runaway containment: the mailer a limit notice leaves through, the
        // directories its administrators are read from, and the routed client
        // a project's own 24-hour traffic is counted on. Composed exactly when
        // this process holds all three — mail is what carries the notice, and
        // tenancy is what knows whom to carry it to.
        ...(mail && tenancy
          ? {
              containment: {
                mailer: mail.delivery,
                directories: {
                  projects: tenancy.projects,
                  authorization: tenancy.authorization,
                },
                resolveClickHouseClient: (projectId: string) =>
                  options.eventing.resolveClickHouseClient(projectId),
                // The upgrade line a ceiling notice carries, over the one
                // PLAN_LIMITS ladder the interactive process quotes from.
                // Composed exactly when this process holds a plan provider and
                // the Prisma client the organization's pricing is read on;
                // without either the notice still sends, naming no upgrade.
                ...(plans && options.connection
                  ? {
                      nextStep: WorkerAutomationNextStepAdapter.create({
                        projects: tenancy.projects,
                        plans,
                        organizations: PrismaAutomationOrganizationPricingAdapter.create(
                          options.connection.client,
                        ),
                        nextStep: PlanNextStepService.create({
                          catalogue: PlanLimitsPlanCatalogueAdapter.create(),
                        }),
                        baseHost: mail.baseHost,
                        ...(options.observability ? { logger: options.observability.logger } : {}),
                      }),
                    }
                  : {}),
              },
            }
          : {}),
        evaluations: WorkerAutomationSettlementEvaluationReader.create({
          resolveClickHouse: options.eventing.resolveClickHouseClient as unknown as Parameters<
            typeof WorkerAutomationSettlementEvaluationReader.create
          >[0]["resolveClickHouse"],
          defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        }),
        heartbeat: WorkerAutomationHeartbeat.create(
          options.eventing.resolveClickHouseClient as unknown as Parameters<
            typeof WorkerAutomationHeartbeat.create
          >[0],
        ),
        ...(graphActivity ? { graphActivity } : {}),
        redis: eventingOptions.groupQueue.redis,
        ...(automationAbsence ? { absence: automationAbsence } : {}),
        ...(options.observability ? { logger: options.observability.logger } : {}),
      }),
      eventing,
      ...(reportSchedule ? { reportSchedule } : {}),
    });
    // Evaluation's durable pipeline, composed here rather than received. It is built AFTER
    // Automation and BEFORE the trace producer check because its two terminal subscribers dispatch
    // through Automation's own recorder and re-evaluate through the graph vertical composed above,
    // while Trace's evaluation trigger dispatches into the commands this installer produces.
    const evaluationTriggerCatalogue = PostgresAutomationTraceTriggerCatalogueAdapter.create({
      prisma: traceDatabase,
      clock: automationClock,
    });
    const recordSpanDispatch = new Deferred<TraceProcessingCommands["recordSpan"]>(
      "worker.trace.recordSpan",
    );
    const renameTraceDispatch = new Deferred<TraceProcessingCommands["changeTraceName"]>(
      "worker.trace.changeTraceName",
    );
    const addAnnotationDispatch = new Deferred<TraceProcessingCommands["addAnnotation"]>(
      "worker.trace.addAnnotation",
    );
    const removeAnnotationDispatch = new Deferred<TraceProcessingCommands["removeAnnotation"]>(
      "worker.trace.removeAnnotation",
    );
    const traceCommands: TraceProcessingCommands = {
      recordSpan: recordSpanDispatch.fn,
      changeTraceName: renameTraceDispatch.fn,
      addAnnotation: addAnnotationDispatch.fn,
      removeAnnotation: removeAnnotationDispatch.fn,
    };
    const evaluationAnalytics = options.featureClickHouse
      ? createWorkerAnalytics({
          resolveClickHouseClient: options.featureClickHouse.resolveClient,
          defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        })
      : void 0;
    const evaluationAutomation = {
      triggers: evaluationTriggerCatalogue,
      graphActivity: graphActivity ?? new AbsentEvaluationGraphActivity(),
      triggerMatches: automation.triggerMatches,
    };
    // The workflow graph a queued evaluation runs on, and the ONE evaluator
    // runtime over it: the resolve, the code run and the native augmentation
    // all reach this install rather than one per collaborator.
    const evaluationWorkflows =
      options.connection && modelProviders && datasets
        ? createWorkerEvaluationWorkflows({
            database: options.connection.client,
            datasets,
            modelProviders: modelProviders.modelProviders,
            secretDecryptor: resolveWorkerStoredSecretCipher(options.config),
            nlpServiceUrl: options.config.infrastructure.modelProvider.nlpServiceUrl,
            payloadStaging: objectStorage.payloadStaging,
          })
        : void 0;
    const evaluationEvaluators =
      foundation && options.connection && modelProviders && options.resources && evaluationWorkflows
        ? await installWorkerEvaluator({
            database: options.connection.client,
            permissions: foundation.tenancy.authorization,
            auditLog: foundation.auditLog,
            users: foundation.users,
            workflows: evaluationWorkflows.workflows,
            nlpRuntime: evaluationWorkflows.nlpRuntime,
            modelProviders: modelProviders.modelProviders,
            resources: options.resources,
            name: "worker evaluation evaluator application",
          })
        : void 0;
    const observabilityApps =
      foundation &&
      options.connection &&
      options.featureClickHouse &&
      modelProviders &&
      plans &&
      options.resources &&
      evaluationAnalytics &&
      datasets &&
      monitors &&
      evaluationWorkflows &&
      evaluationEvaluators
        ? await createWorkerObservabilityApps({
            connection: options.connection,
            config: options.config,
            redis: processRedis,
            storage: objectStorage,
            resolveClickHouseClient: options.featureClickHouse.resolveClient,
            foundation: {
              projects: foundation.tenancy.projects,
              organizations: foundation.tenancy.organizations,
              authorization: foundation.tenancy.authorization,
              users: foundation.users,
              retention: foundation.retention,
              shares: foundation.tenancy.shares,
              topics: foundation.tenancy.topics,
            },
            models: modelProviders,
            githubSigningKey: options.config.githubSigningKey,
            plans,
            featureFlags,
            resources: options.resources,
            canonicalisation: traceCanonicalisation,
            summaryStore: traceStores.traceSummaryStore,
            commands: traceCommands,
            evaluation: {
              database: options.connection.client,
              workflows: evaluationWorkflows,
              evaluators: evaluationEvaluators,
              datasets,
              monitors,
              modelProviders: modelProviders.modelProviders,
              models: modelProviders,
              secretDecryptor: resolveWorkerStoredSecretCipher(options.config),
              nlpServiceUrl: options.config.infrastructure.modelProvider.nlpServiceUrl,
              payloadStaging: objectStorage.payloadStaging,
              featureFlags,
              storage: objectStorage,
              langevalsEndpoint: options.config.langevals.endpoint,
              evaluationEnvironment: options.config.evaluationEnvironment,
              resolveClickHouseClient: options.eventing.resolveClickHouseClient,
              defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
              analytics: evaluationAnalytics,
              traces: settlementTraceReader,
              automation: evaluationAutomation,
              redis: processRedis,
              foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds,
              processing: new WorkerEvaluationProcessingResult(),
            },
          })
        : void 0;
    if (observabilityApps) {
      agentTracePeers.bind(TraceApi, observabilityApps.traces);
      agentTracePeers.ready();
      dataPrivacyApis.bind(DataPrivacyApi, observabilityApps.dataPrivacy);
      dataPrivacyApis.ready();
      annotationQueueDispatch.resolve(async (input) => {
        await observabilityApps.annotations.queueTraces(input);
      });
    }
    if (agentApps && !observabilityApps) {
      throw new Error("Agent scenario execution requires the installed TraceApi.");
    }
    const evaluation = EvaluationWorkerFeatureInstaller.create({
      installer:
        observabilityApps?.evaluationProcessing ??
        createWorkerEvaluationProcessing({
          resolveClickHouseClient: options.eventing.resolveClickHouseClient,
          defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
          analytics: createWorkerAnalytics({
            resolveClickHouseClient: options.eventing
              .resolveClickHouseClient as unknown as Parameters<
              typeof createWorkerAnalytics
            >[0]["resolveClickHouseClient"],
            defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
          }),
          traces: settlementTraceReader,
          automation: {
            triggers: evaluationTriggerCatalogue,
            graphActivity: graphActivity ?? new AbsentEvaluationGraphActivity(),
            triggerMatches: automation.triggerMatches,
          },
          redis: eventingOptions.groupQueue.redis,
          ...(options.config.eventing.foldCacheTtlSeconds === undefined
            ? {}
            : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
          ...(WorkerProductionComposition.evaluationAbsence(options)
            ? { absence: WorkerProductionComposition.evaluationAbsence(options)! }
            : {}),
        }),
      eventing,
    });
    const experimentIdLookup = ExperimentEventingAdapter.create({
      resolveClient: options.eventing.resolveClickHouseClient,
      clickhouseEnabled: true,
    }).idLookup();
    const traceProducers = WorkerProductionComposition.requireTraceProducers({
      automation,
      evaluation,
      scenario,
      consumers: options.eventing.consumers,
    });
    const trace = TraceWorkerFeatureInstaller.create({
      installer: TraceProcessingServerInstallerAdapter.create({
        pipeline: WorkerTraceProcessingPipeline.create({
          config: options.config,
          services: traceServices,
          featureFlags,
          traceCanonicalisation,
          stores: {
            spanAppendStore: createWorkerSpanStorage({
              resolveClickHouseClient: options.eventing.resolveClickHouseClient,
              defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
            }),
            ...traceStores,
          },
          commands: {
            executeEvaluation: traceProducers.executeEvaluation,
            reportEvaluation: traceProducers.reportEvaluation,
            computeRunMetrics: traceProducers.computeRunMetrics,
            computeExperimentRunMetrics: experiment.commands.computeExperimentRunMetrics,
            lookupExperimentId: (tenantId, runId) =>
              experimentIdLookup.findExperimentId({ tenantId, runId }),
            bootstrapTopicClustering: (projectId) =>
              topic.commands.bootstrapTopicClustering(projectId),
            contributeSpanFacts: codingAgent.commands.contributeSpanFacts,
            triggerMatches: traceProducers.triggerMatches,
          },
          traceTriggers: PostgresAutomationTraceTriggerCatalogueAdapter.create({
            prisma: traceDatabase,
            clock: new WorkerAutomationClock(),
          }),
          ...(graphActivity ? { graphActivity } : {}),
          productAnalytics: createWorkerTraceProductAnalytics({
            config: options.config.productAnalytics,
            ...(options.resources ? { resources: options.resources } : {}),
            ...(options.observability ? { logger: options.observability.logger } : {}),
          }),
          ...(traceBroadcast ? { broadcast: traceBroadcast } : {}),
          spool: createWorkerTraceSpool({
            runtime: objectStorage.runtime,
            aws: objectStorage.aws,
            azureRetentionConfirmed:
              options.config.infrastructure.storage.azureSpoolRetentionConfirmed,
            ...(options.observability ? { logger: options.observability.logger } : {}),
          }),
          ...createWorkerGovernanceRollups({
            resolveClickHouseClient: options.eventing.resolveClickHouseClient,
            ...(options.observability ? { logger: options.observability.logger } : {}),
          }),
          codingAgentTraces: WorkerCodingAgentTraceProcessingAdapter.create({
            traceCanonicalisation,
            spans: TraceStoredSpanReaderClickHouseRepository.create({
              resolveClient: options.eventing.resolveClickHouseClient,
              defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
            }),
          }),
          trackedEvents,
        }),
        datasetNormalization: createWorkerDatasetNormalization({
          database: traceDatabase,
          storage: objectStorage,
        }),
      }),
      eventing,
    });
    // The one dispatch Trace makes into itself: the tracked-event reactor mints
    // a synthetic span and sends it the way an SDK export would, so it can only
    // be wired once the definition that contains the reactor is registered.
    recordSpanDispatch.resolve(trace.commands.recordSpan);
    renameTraceDispatch.resolve(trace.commands.changeTraceName);
    addAnnotationDispatch.resolve(trace.commands.addAnnotation);
    removeAnnotationDispatch.resolve(trace.commands.removeAnnotation);
    trackedEvents.connect(trace.commands.recordSpan);
    // Topic's runtime, composed here rather than received. Its execution
    // ports are this process's own — the tenant-keyed ClickHouse client the
    // event store already resolves through, the model gateway above, a direct
    // langevals POST, and an OTLP metrics adapter that writes the same two
    // series the App writes.
    const topicRuntime = createWorkerTopicRuntime({
      config: options.config,
      database: options.database,
      redis: processRedis,
      resolveClickHouseClient: options.eventing.resolveClickHouseClient as unknown as Parameters<
        typeof createWorkerTopicRuntime
      >[0]["resolveClickHouseClient"],
      ...(modelProviders ? { modelProviders: modelProviders.modelProviders } : {}),
      ...(WorkerProductionComposition.topicAbsence(options)
        ? { absence: WorkerProductionComposition.topicAbsence(options)! }
        : {}),
    });
    const topicServer = TopicServerInstallerAdapter.create({
      database: topicRuntime.database,
      processStore: eventing.processStore,
      redis: topicRuntime.redis,
      execution: topicRuntime.execution,
      metrics: topicRuntime.metrics,
    });
    topicRequest.resolve((input) => topicServer.commandDispatch.requestClustering(input));
    const topic = TopicWorkerFeatureInstaller.create({
      installer: topicServer,
      eventing,
      traceAssignments: trace.traceAssignments,
    });
    // UNCONDITIONAL, like the two pipelines around it. `pulled_usage_processing` and
    // `ingestion_pull_processing` carry eight routing keys between them in the checked-in `job-
    // registry.json`, and the queue rejects an unroutable job for redelivery rather than dropping
    // it — so a graph that mounted the rest and left these out would stall every configured
    // customer's usage pull forever with the pods up and the queue depth simply growing.
    const governanceIngestion = GovernanceIngestionWorkerFeatureInstaller.create({
      installer: createWorkerGovernanceIngestion({
        config: options.config,
        database: options.database,
        resolveClickHouseClient: options.eventing.resolveClickHouseClient,
        projects: PostgresGovernanceInternalProjectAdapter.create({
          database: options.database as never,
          teams: PrismaGovernanceOldestTeamAdapter.create(options.database),
        }).build(),
        featureFlags,
        aws: objectStorage.aws,
        encryption: resolveWorkerStoredSecretCipher(options.config),
        ...(options.observability ? { logger: options.observability.logger } : {}),
      }),
      eventing,
    });
    // Unconditional, exactly as the legacy registry registers it, and for the same reason the
    // sweeps above are: every dependency is composed from this package over substrates this process
    // already holds. The roll-up is a command-only pipeline — no projections, no subscribers — so
    // on a self-hosted install nothing dispatches into it; registering it either way is what keeps
    // producer and consumer routing one key set off the shared `event-sourcing/jobs` queue.
    const billingReportingPersistence = PostgresBillingReportingAdapter.create({
      database: options.database,
    }).build();
    const billableEvents = BillableEventsQueryService.create(
      ClickHouseBillingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        resolveOrganizationClient: options.eventing.resolveClickHouseClient,
      }).build(),
    );
    const usageReporting = options.config.deployment.saas
      ? StripeUsageReportingAdapter.create({
          secretKey: options.config.stripe.secretKey,
          nodeEnvironment: options.config.nodeEnvironment,
        }).build()
      : undefined;
    const billingReporting = BillingReportingWorkerFeatureInstaller.create({
      installer: EventingBillingReportingAdapter.create({
        organizations: billingReportingPersistence.organizations,
        billingCheckpoints: billingReportingPersistence.checkpoints,
        getUsageReportingService: () => usageReporting,
        queryBillableEventsTotal: (input) => billableEvents.tryQueryBillableEventsTotal(input),
        organizationCache: RedisBillingOrganizationCacheAdapter.create({
          redis: eventingOptions.groupQueue.redis,
        }),
        errorReporter: ObservabilityBillingErrorAdapter.create(),
      }),
      eventing,
    });
    billingReportingInstallerHolder.current = billingReporting;
    // Pipeline registration connects this shared dispatcher before consumption.
    const authz = AuthzWorkerFeatureInstaller.create({
      installer: {
        dispatcher: authzDispatcher,
        pipeline: PostgresAuthzPipelineAdapter.create({
          database: options.database,
        }).build(),
      },
      eventing,
    });
    // Unconditional, on the same footing as the sweeps and the two processing pipelines above: both
    // ledgers are composed from their own feature package over the one Prisma client this process
    // opened, so there is no graph in which they are present but unbuildable.
    const identity = IdentityWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresIdentityPipelineAdapter.create({
          database: options.database,
        }).build(),
      },
      eventing,
    });
    // Unconditional for the same reason, and it needs strictly less: the
    // directory-sync ledger has no process manager at all, so its whole graph
    // is one `ScimSyncState` head serving both the fold and its guards.
    const scimSync = ScimSyncWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresScimSyncPipelineAdapter.create({
          database: options.database,
        }).build(),
      },
      eventing,
    });
    // UNCONDITIONAL now, like the three ledgers around it. `sso-connections` names fourteen
    // commands, a state projection and the teardown grace subscriber in the checked-in `job-
    // registry.json`, and this is the ONLY graph that can advance TEARDOWN_PENDING to TORN_DOWN —
    // so a process that claimed the queue without it would leave every requested teardown pending
    // forever with the pods up and the probe answering.
    WorkerProductionComposition.identityAbsence(options)?.withoutDirectoryTokenRevocation();
    const ssoConnection = SsoConnectionWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresSsoConnectionPipelineAdapter.create({
          database: options.database,
          eventSourcing: eventing.eventSourcing,
          operators: WorkerProductionComposition.platformOperators({
            adminEmails: options.config.deployment.adminEmails,
          }),
        }).build(),
      },
      eventing,
    });
    // Composed here, on the mail capability this process now owns. Everything else the join ledger
    // takes is Postgres: the `JoinRequest` head serving both the fold and its guards, and the
    // audience its two notices are addressed to. UNCONDITIONAL, unlike the connection ledger above.
    const joinRequest = JoinRequestWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresJoinRequestPipelineAdapter.create({
          database: options.database,
          eventSourcing: eventing.eventSourcing,
          mail: mail
            ? JoinRequestMailAdapter.create({
                mailer: mail.delivery,
                renderer: mail.renderer,
                baseHost: mail.baseHost,
              })
            : AbsentJoinRequestMail.create(),
        }).build(),
      },
      eventing,
    });
    const enterprise = options.enterprise
      ? EnterpriseWorkerComposition.create(options.enterprise)
      : undefined;

    return WorkerProductionComposition.createFromPorts({
      config: options.config,
      eventing,
      lifecycle: options.lifecycle,
      transport: options.transport,
      featureApps: new WorkerFeatureAppsInstaller(
        ...[observabilityApps, agentApps].filter((app) => app !== void 0),
      ),
      automation,
      eventingMaintenance,
      langyMaintenance,
      langyConversation,
      apiKey,
      github,
      evaluation,
      codingAgent,
      governanceEvents,
      gatewaySpend,
      gatewayRealtimeSession,
      metric,
      log,
      topic,
      trace,
      suite,
      scenario,
      scenarioExecution,
      experiment,
      governanceIngestion,
      billingReporting,
      opsWorkers,
      authz,
      identity,
      ssoConnection,
      scimSync,
      joinRequest,
      enterprise,
      observability: options.observability,
      resources: options.resources,
      infrastructure,
    });
  }

  /**
   * Refuses a consuming graph that cannot send mail. `join-requests` names five commands, a state
   * projection and the lifecycle subscriber in the checked-in `job-registry.json`, and the queue
   * rejects an unroutable job for redelivery rather than dropping it.
   */
  private static requireMailForConsumers(input: {
    mail: WorkerMailComposition | undefined;
    consumers: WorkerEventingConsumerOptions | undefined;
    resources: ResourceScope | undefined;
  }): void {
    if (input.mail || !input.consumers?.enabled || !input.resources) return;
    throw new Error(
      "The worker composition will not claim event-sourcing/jobs without outbound mail: the join-request pipeline's routing keys are in the job registry and its two wakes are notifications. Set BASE_HOST so the mail capability composes.",
    );
  }

  /**
   * The three producers Trace's own subscribers dispatch into. A GRAPH THAT CONSUMES MUST HAVE ALL
   * THREE. `reactor:evaluationTrigger` and `reactor:customEvaluationSync` send into Evaluation,
   * `reactor:simulationMetricsSync` into Scenario, and `reactor:triggerMatch` into Automation.
   */
  private static requireTraceProducers(input: {
    automation: AutomationWorkerFeatureInstaller | undefined;
    evaluation: EvaluationWorkerFeatureInstaller | undefined;
    scenario: ScenarioWorkerFeatureInstaller | undefined;
    consumers: WorkerEventingConsumerOptions | undefined;
  }): Pick<
    WorkerTraceProcessingCommands,
    "executeEvaluation" | "reportEvaluation" | "computeRunMetrics" | "triggerMatches"
  > {
    const missing = [
      input.automation ? undefined : "automation",
      input.evaluation ? undefined : "evaluation",
      input.scenario ? undefined : "scenario",
    ].filter((name): name is string => name !== undefined);

    if (missing.length > 0 && input.consumers?.enabled) {
      throw new Error(
        `The worker composition will not claim event-sourcing/jobs without ${missing.join(", ")}: trace processing dispatches into all three, and their work would redeliver forever.`,
      );
    }

    const refuse = (feature: string) => (): Promise<never> => {
      throw new Error(
        `Trace processing dispatched into ${feature}, which this graph did not compose.`,
      );
    };

    const evaluationCommands = input.evaluation?.commands;
    const scenarioCommands = input.scenario?.commands;

    return {
      executeEvaluation: evaluationCommands
        ? (data, sendOptions) =>
            evaluationCommands.executeEvaluation(
              data,
              sendOptions as Parameters<typeof evaluationCommands.executeEvaluation>[1],
            )
        : refuse("evaluation"),
      reportEvaluation: evaluationCommands
        ? (data) => evaluationCommands.reportEvaluation(data)
        : refuse("evaluation"),
      computeRunMetrics: scenarioCommands
        ? (data) => scenarioCommands.computeRunMetrics(data)
        : refuse("scenario"),
      triggerMatches: input.automation?.triggerMatches ?? new AbsentTraceTriggerMatches(),
    };
  }

  /** The boot logger, as the one place Trace's storage absences are declared. */
  private static traceAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerTraceAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerTraceAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the spend graph's absences are declared. */
  private static gatewayAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerGatewaySpendAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerGatewaySpendAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place Scenario's execution absence is declared. */
  private static scenarioAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerScenarioAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerScenarioAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the operational loops' absences are declared. */
  private static opsAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerOpsAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerOpsAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the voice reconciler's absence is declared. */
  private static realtimeSessionAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerRealtimeSessionAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerRealtimeSessionAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the scenario EXECUTOR's absence is declared. */
  private static scenarioExecutionAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerScenarioExecutionAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerScenarioExecutionAbsence.create(options.config.serviceName)
      : undefined;
  }

  /** The boot logger, as the one place Automation settlement's absences are declared. */
  private static automationAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerAutomationSettlementAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerAutomationSettlementAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place Langy's three absences are declared. */
  private static langyAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerLangyAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerLangyAbsence.create(options.observability.logger)
      : undefined;
  }

  /**
   * The deployment's operator list, as identity's port over it. `ADMIN_EMAILS` is parsed once, by
   * the ops feature that owns the variable, so the connection guards and the back office answer
   * from the same list.
   */
  private static platformOperators({
    adminEmails,
  }: {
    adminEmails: string | undefined;
  }): PlatformOperatorPort {
    const access = AdminAccessService.create({ adminEmails: adminEmails ?? "" });

    return { isPlatformOperatorEmail: ({ email }) => access.isAdmin({ email }) };
  }

  /** The boot logger, as the one place Identity's one absence is declared. */
  private static identityAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerIdentityAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerIdentityAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the model gateway's absences are declared. */
  private static modelProviderAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerModelProviderAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerModelProviderAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place Topic's one absence is declared. */
  private static topicAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerTopicAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerTopicAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place Evaluation's one absence is declared. */
  private static evaluationAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerEvaluationAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerEvaluationAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place a composition absence is declared. */
  private static githubAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerGithubAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerGithubAbsence.create(options.observability.logger)
      : undefined;
  }

  /**
   * Keeps ports testable and lets a host supply already-composed technical
   * resources without manufacturing in-memory production substitutes.
   */
  static createFromPorts(options: {
    config: WorkerConfig;
    eventing: WorkerEventingRuntime;
    lifecycle: WorkerLifecyclePort;
    transport: WorkerTransportPort;
    featureApps?: WorkerFeatureInstallerPort;
    automation?: AutomationWorkerFeatureInstaller;
    eventingMaintenance?: EventingMaintenanceWorkerFeatureInstaller;
    langyConversation?: LangyConversationWorkerFeatureInstaller;
    langyMaintenance?: LangyMaintenanceWorkerFeatureInstaller;
    apiKey?: ApiKeyWorkerFeatureInstaller;
    github?: GithubWorkerFeatureInstaller;
    evaluation?: EvaluationWorkerFeatureInstaller;
    codingAgent?: CodingAgentWorkerFeatureInstaller;
    governanceEvents?: GovernanceEventsWorkerFeatureInstaller;
    gatewaySpend?: GatewaySpendWorkerFeatureInstaller;
    gatewayRealtimeSession?: GatewayRealtimeSessionWorkerFeatureInstaller;
    metric?: MetricWorkerFeatureInstaller;
    log?: LogWorkerFeatureInstaller;
    topic: TopicWorkerFeatureInstaller;
    trace: TraceWorkerFeatureInstaller;
    suite?: SuiteWorkerFeatureInstaller;
    scenario?: ScenarioWorkerFeatureInstaller;
    scenarioExecution?: ScenarioExecutionWorkerFeatureInstaller;
    opsWorkers?: OpsWorkerFeatureInstaller;
    experiment?: ExperimentWorkerFeatureInstaller;
    governanceIngestion?: GovernanceIngestionWorkerFeatureInstaller;
    billingReporting?: BillingReportingWorkerFeatureInstaller;
    authz?: AuthzWorkerFeatureInstaller;
    identity?: IdentityWorkerFeatureInstaller;
    ssoConnection?: SsoConnectionWorkerFeatureInstaller;
    scimSync?: ScimSyncWorkerFeatureInstaller;
    joinRequest?: JoinRequestWorkerFeatureInstaller;
    enterprise?: EnterpriseWorkerComposition | EnterpriseWorkerCompositionOptions;
    observability?: ProcessObservability;
    resources?: ResourceScope;
    infrastructure?: WorkerInfrastructureAdapter;
  }): WorkerProductionComposition {
    const lifecycle = WorkerProductionLifecycle.create(options.lifecycle);
    const runtime = WorkerRuntime.create({
      lifecycle,
      transport: options.transport,
      resources: options.resources,
    });
    const featureInstallers = orderedFeatureInstallers(options);
    const application = WorkerApplication.create({
      runtime,
      eventing: options.eventing,
      featureInstallers,
    });

    options.observability?.logger.info(
      {
        environment: options.config.environment,
        features: featureInstallers.map((installer) => installer.name),
      },
      "worker production graph composed",
    );

    const enterprise =
      options.enterprise instanceof EnterpriseWorkerComposition
        ? options.enterprise
        : options.enterprise
          ? EnterpriseWorkerComposition.create(options.enterprise)
          : undefined;

    return new WorkerProductionComposition({
      application,
      eventing: options.eventing,
      topic: options.topic,
      trace: options.trace,
      enterprise,
      infrastructure: options.infrastructure,
      featureInstallers,
      automation: options.automation,
      evaluation: options.evaluation,
      codingAgent: options.codingAgent,
      governanceEvents: options.governanceEvents,
      gatewaySpend: options.gatewaySpend,
      suite: options.suite,
      scenario: options.scenario,
      experiment: options.experiment,
      governanceIngestion: options.governanceIngestion,
      billingReporting: options.billingReporting,
    });
  }

  readonly application: WorkerApplication;
  readonly eventing: WorkerEventingRuntime;
  readonly topic: TopicWorkerFeatureInstaller;
  readonly trace: TraceWorkerFeatureInstaller;
  readonly enterprise: EnterpriseWorkerComposition | undefined;
  readonly infrastructure: WorkerInfrastructureAdapter | undefined;
  /** Exactly the installers the application mounts, in mount order. */
  readonly featureInstallers: readonly WorkerFeatureInstallerPort[];
  /**
   * The installers a host wires producers against. Each publishes callable command proxies that
   * refuse until the installer has registered, so exposing them here is what lets a host hand a
   * producer its dispatcher before the graph starts without risking a silent drop.
   */
  readonly automation: AutomationWorkerFeatureInstaller | undefined;
  readonly evaluation: EvaluationWorkerFeatureInstaller | undefined;
  readonly codingAgent: CodingAgentWorkerFeatureInstaller | undefined;
  readonly governanceEvents: GovernanceEventsWorkerFeatureInstaller | undefined;
  readonly gatewaySpend: GatewaySpendWorkerFeatureInstaller | undefined;
  readonly suite: SuiteWorkerFeatureInstaller | undefined;
  readonly scenario: ScenarioWorkerFeatureInstaller | undefined;
  readonly experiment: ExperimentWorkerFeatureInstaller | undefined;
  readonly governanceIngestion: GovernanceIngestionWorkerFeatureInstaller | undefined;
  readonly billingReporting: BillingReportingWorkerFeatureInstaller | undefined;

  private constructor(parts: {
    application: WorkerApplication;
    eventing: WorkerEventingRuntime;
    topic: TopicWorkerFeatureInstaller;
    trace: TraceWorkerFeatureInstaller;
    enterprise: EnterpriseWorkerComposition | undefined;
    infrastructure: WorkerInfrastructureAdapter | undefined;
    featureInstallers: readonly WorkerFeatureInstallerPort[];
    automation: AutomationWorkerFeatureInstaller | undefined;
    evaluation: EvaluationWorkerFeatureInstaller | undefined;
    codingAgent: CodingAgentWorkerFeatureInstaller | undefined;
    governanceEvents: GovernanceEventsWorkerFeatureInstaller | undefined;
    gatewaySpend: GatewaySpendWorkerFeatureInstaller | undefined;
    suite: SuiteWorkerFeatureInstaller | undefined;
    scenario: ScenarioWorkerFeatureInstaller | undefined;
    experiment: ExperimentWorkerFeatureInstaller | undefined;
    governanceIngestion: GovernanceIngestionWorkerFeatureInstaller | undefined;
    billingReporting: BillingReportingWorkerFeatureInstaller | undefined;
  }) {
    this.application = parts.application;
    this.eventing = parts.eventing;
    this.topic = parts.topic;
    this.trace = parts.trace;
    this.enterprise = parts.enterprise;
    this.infrastructure = parts.infrastructure;
    this.featureInstallers = parts.featureInstallers;
    this.automation = parts.automation;
    this.evaluation = parts.evaluation;
    this.codingAgent = parts.codingAgent;
    this.governanceEvents = parts.governanceEvents;
    this.gatewaySpend = parts.gatewaySpend;
    this.suite = parts.suite;
    this.scenario = parts.scenario;
    this.experiment = parts.experiment;
    this.governanceIngestion = parts.governanceIngestion;
    this.billingReporting = parts.billingReporting;
  }
}

/**
 * The one registration order, and the reason it is written down.
 *   identity             the four ADR-101 ledgers, after AuthZ exactly as the
 */
function orderedFeatureInstallers(
  options: Parameters<typeof WorkerProductionComposition.createFromPorts>[0],
): readonly WorkerFeatureInstallerPort[] {
  return [
    options.automation,
    options.eventingMaintenance,
    options.langyMaintenance,
    options.apiKey,
    options.github,
    options.evaluation,
    options.codingAgent,
    options.governanceEvents,
    options.gatewaySpend,
    options.gatewayRealtimeSession,
    options.metric,
    options.log,
    options.trace,
    options.suite,
    options.scenario,
    options.scenarioExecution,
    options.experiment,
    options.langyConversation,
    options.topic,
    options.governanceIngestion,
    options.billingReporting,
    options.opsWorkers,
    options.authz,
    options.identity,
    options.ssoConnection,
    options.scimSync,
    options.joinRequest,
    options.featureApps,
  ].filter((installer) => installer !== undefined);
}

class WorkerProductionLifecycle extends WorkerLifecyclePort {
  static create(lifecycle: WorkerLifecyclePort): WorkerProductionLifecycle {
    return new WorkerProductionLifecycle(lifecycle);
  }

  private constructor(private readonly lifecycle: WorkerLifecyclePort) {
    super();
  }

  async close(): Promise<void> {
    await this.lifecycle.close();
  }
}

/**
 * The Group Queue's own blob keyspace pass.
 */
class WorkerGroupQueueBlobSweep extends WorkerBlobSweepPort {
  static create(
    redis: EventingServerRuntimeOptions["groupQueue"]["redis"],
  ): WorkerGroupQueueBlobSweep {
    return new WorkerGroupQueueBlobSweep(new BlobSweeper({ redis }));
  }

  private constructor(private readonly sweeper: BlobSweeper) {
    super();
  }

  sweep(): Promise<BlobSweepReport> {
    return this.sweeper.sweep();
  }
}

/**
 * The one organization read the internal governance project mint makes. The oldest team is where an
 * organization's internal project is created, and `OrganizationService` answers it by exactly this
 * query — a `findFirst` ordered by creation.
 */
class PrismaGovernanceOldestTeamAdapter extends ProjectOldestTeamPort {
  static create(database: { team: { findFirst: (args: never) => Promise<unknown> } }) {
    return new PrismaGovernanceOldestTeamAdapter(database);
  }

  private constructor(
    private readonly database: { team: { findFirst: (args: never) => Promise<unknown> } },
  ) {
    super();
  }

  async getOldestTeamId({ organizationId }: { organizationId: string }): Promise<string> {
    const team = (await this.database.team.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    } as never)) as { id: string } | null;
    if (!team) {
      throw new Error(`Organization ${organizationId} has no team to hold its internal project.`);
    }
    return team.id;
  }
}

/**
 * The two organization columns an automation upgrade line is quoted from. Read here
 * because they are one `findUnique` on the client this process already opened, and
 * carrying an organization repository into automation's mail to reach two columns
 * would couple the notice to an aggregate it never otherwise touches.
 */
class PrismaAutomationOrganizationPricingAdapter extends WorkerAutomationOrganizationPricingPort {
  static create(database: {
    organization: { findUnique: (args: never) => Promise<unknown> };
  }): PrismaAutomationOrganizationPricingAdapter {
    return new PrismaAutomationOrganizationPricingAdapter(database);
  }

  private constructor(
    private readonly database: { organization: { findUnique: (args: never) => Promise<unknown> } },
  ) {
    super();
  }

  async pricingFor({ organizationId }: { organizationId: string }): Promise<{
    pricingModel: EntitlementPricingModel | null;
    currency: "USD" | "EUR";
  } | null> {
    const organization = (await this.database.organization.findUnique({
      where: { id: organizationId },
      select: { pricingModel: true, currency: true },
    } as never)) as {
      pricingModel: EntitlementPricingModel | null;
      currency: "USD" | "EUR";
    } | null;

    return organization;
  }
}

function createEventingPersistence(
  options: WorkerProductionCompositionOptions,
  infrastructure: WorkerInfrastructureAdapter | undefined,
): EventingServerRuntimeOptions {
  if (!options.infrastructure) return withoutConsumers(options.eventing);
  if (!infrastructure) {
    throw new Error("Worker infrastructure was not constructed for the production graph.");
  }
  return {
    ...withoutConsumers(options.eventing),
    groupQueue: infrastructure.queueDependencies,
  };
}

/**
 * The SaaS cross-pipeline meter pair, composed from this process's own graph. Three substrates, and
 * none of them is new to this composition: the tenant- keyed ClickHouse client the event store
 * already resolves through, the one Prisma client this process opened, and the queue's one Redis.
 */
export function saasBillableEventsMeter(options: {
  database: BillingTenantOrganizationDatabase;
  redis: EventingServerRuntimeOptions["groupQueue"]["redis"];
  resolveClickHouseClient: EventingServerRuntimeOptions["resolveClickHouseClient"];
  getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>;
}): NonNullable<WorkerEventingProductionOptions["configureGlobalProjections"]> {
  const organizations = BillingTenantOrganizationService.create({
    organizations: PostgresBillingTenantOrganizationAdapter.create({
      database: options.database,
    }).build().organizations,
    cache: RedisBillingTenantOrganizationCacheAdapter.create({ redis: options.redis }),
  });
  const meter = EventingBillableEventsMeterAdapter.create({
    organizations,
    meter: ClickHouseBillableEventsMeterAdapter.create({
      resolveClient: (organizationId) => options.resolveClickHouseClient(organizationId),
    }).build(),
  }).build();
  const dispatch = EventingBillingMeterDispatchAdapter.create({
    organizations,
    getDispatch: options.getDispatch,
  }).build();

  return (registry) => {
    registry.registerMapProjection(meter);
    registry.registerMapSubscriber(meter.name, dispatch);
  };
}

/** Consumer ownership belongs to the Eventing runtime, not to its adapters. */
function withoutConsumers<Options extends WorkerEventingConsumerCompositionOptions>(
  options: Options,
): Omit<Options, "consumers"> {
  const { consumers: _consumers, ...persistence } = options;
  return persistence;
}

/** Names the spend graph's four absences once, at boot, rather than leaving them inferred. */
export class LoggedWorkerGatewaySpendAbsence extends WorkerGatewaySpendAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerGatewaySpendAbsence {
    return new LoggedWorkerGatewaySpendAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutSpendSettlement(): void {
    this.logger.warn(
      { reason: "no-clickhouse-instance-directory" },
      "worker composed the gateway spend pipeline without a settlement sweeper: the sweep settles every configured ClickHouse instance in one pass and this graph was handed a tenant-keyed resolver as a port rather than a connection it can enumerate, so a request whose confirmation never arrives stays admitted rather than being settled as cost-unknown",
    );
  }

  withoutSqsWebhookDestinations(): void {
    this.logger.warn(
      { reason: "no-aws-transport" },
      "worker composed webhook delivery without an AWS transport: an endpoint that delivers to a queue is refused by name rather than retried, so its events never arrive",
    );
  }

  withoutWebhookEntitlements(): void {
    this.logger.warn(
      { reason: "no-typed-prisma-connection" },
      "worker composed webhook delivery without an entitlement graph: the plan is resolved from the deployment's own subscription rows over the typed Prisma client this graph was given none of, so the batch is refused rather than delivered to an organization that may not have bought the feature, and a baseline plan answered here would silently stop delivering to organizations that did",
    );
  }

  withoutEndpointSecretKey(): void {
    this.logger.warn(
      "worker composed webhook delivery without a credentials key: an endpoint whose secrets this deployment encrypted cannot be read, so no signature is produced for it",
    );
  }
}

/** Names the missing execution pool once, at boot, rather than leaving it inferred. */
export class LoggedWorkerScenarioAbsence extends WorkerScenarioAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerScenarioAbsence {
    return new LoggedWorkerScenarioAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutExecutionPool(): void {
    this.logger.warn(
      "worker composed the simulation pipeline without an execution pool: a queued run is refused into the outbox rather than started, and the stall wake finishes it as an error if no process ever executes it",
    );
  }
}

/**
 * Automation settlement's seven absences, said once at boot: one class
 * rather than seven checks scattered through the graph, because they answer
 * one question a reader has exactly once.
 */
export class LoggedWorkerAutomationSettlementAbsence extends WorkerAutomationSettlementAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerAutomationSettlementAbsence {
    return new LoggedWorkerAutomationSettlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutTraceRecordRead(): void {
    this.logger.warn(
      { reason: "no-typed-prisma-connection" },
      "worker composed automation settlement without the full trace read: the read is Trace's own packaged legacy read and needs the typed Prisma client this graph was given none of, so a digest entry whose summary fold has not landed is refused rather than filled in from the trace record, and ADD_TO_DATASET cannot map a row",
    );
  }

  withoutDatasetPersist(): void {
    this.logger.warn(
      { reason: "no-typed-prisma-connection" },
      "worker composed automation settlement without the dataset write: the row mapping is composed and is the same one the customer previewed with, but the dataset service the mapped rows are appended through needs the typed Prisma client this graph was given none of, so an ADD_TO_DATASET automation is refused by name",
    );
  }

  withoutAnnotationQueuePersist(): void {
    this.logger.warn(
      { reason: "no-typed-prisma-connection" },
      "worker composed automation settlement without an annotation queue writer: the write is Annotation's own createOrUpdateQueueItems over the typed Prisma client this graph was given none of, so an ADD_TO_ANNOTATION_QUEUE automation is refused by name",
    );
  }

  withoutRunawayContainment(): void {
    this.logger.warn(
      { reason: "no-mail-or-no-tenancy" },
      "worker composed automation settlement without runaway containment: a limit notice goes to the ORGANIZATION's administrators and links back to this deployment's own host, so it needs both the mail graph BASE_HOST unlocks and the tenancy directories the role bindings are read from — an automation past its daily ceiling still skips and still logs the breach, but nobody is notified and a misconfigured automation is not paused",
    );
  }

  withoutPlanResolvedPersistCap(): void {
    this.logger.warn(
      { reason: "no-typed-prisma-connection" },
      "worker composed automation settlement without a plan-resolved persist ceiling: the tier is read from the deployment's own subscription rows over the typed Prisma client this graph was given none of, so the daily ceiling is the paid tier for every project rather than the one its plan grants — deliberately the generous answer, because a background process that guessed low would skip confirmed matches a customer had bought the right to keep",
    );
  }

  withoutGraphAlertEvaluation(): void {
    this.logger.warn(
      "worker composed automation settlement without the graph-alert vertical: the 30-second sweep still runs and its candidates are refused by name rather than evaluated",
    );
  }

  withoutNotificationDelivery(): void {
    this.logger.warn(
      "worker composed automation settlement without outbound delivery: BASE_HOST is unset, so matches settle and claim but the digest that would carry links back to the deployment is refused by name",
    );
  }
}

/** Names Langy's three conversation absences once, at boot, rather than leaving them inferred. */
export class LoggedWorkerLangyAbsence extends WorkerLangyAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerLangyAbsence {
    return new LoggedWorkerLangyAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutAgentManager(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without an agent manager: LANGY_AGENT_URL and LANGY_INTERNAL_SECRET are unset, so every dispatched turn is answered unavailable and fails rather than running",
    );
  }

  withoutTitleGeneration(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without model resolution: conversations keep the title they were given and none is generated from the transcript",
    );
  }

  withoutSessionKeyMint(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without an API-key service: the authorization graph itself is composed here, but a mint ATTACHES a grant and this process registers the grants pipeline as a consumer rather than resolving its command senders, so a turn whose agent manager asks for credentials cannot be recovered and fails instead",
    );
  }
}

/** Names the missing GitHub App once, at boot, rather than leaving it inferred. */
export class LoggedWorkerGithubAbsence extends WorkerGithubAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerGithubAbsence {
    return new LoggedWorkerGithubAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutAppCredentials(): void {
    this.logger.warn(
      { reason: "no-github-app-credentials" },
      "worker composed GitHub branch maintenance without App credentials: pull-request linkage is not re-checked, and only its retention half runs",
    );
  }
}

/**
 * Reports the composition decision an absent directory capability would otherwise hide. The
 * connection pipeline mounts either way, so all sixteen of its routing keys are claimed and a
 * requested teardown completes on time.
 */
export abstract class WorkerIdentityAbsenceReportPort {
  abstract withoutDirectoryTokenRevocation(): void;
}

/** Names Identity's one absence once, at boot, rather than leaving it inferred. */
export class LoggedWorkerIdentityAbsence extends WorkerIdentityAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerIdentityAbsence {
    return new LoggedWorkerIdentityAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutDirectoryTokenRevocation(): void {
    this.logger.warn(
      { reason: "no-directory-capability" },
      "worker composed the SSO connection ledger without a directory capability: NO process in this deployment revokes, and the work is one scoped delete of the connection's SCIM token rows — so a torn-down connection completes on time and those rows are left in place, where they fail verification against the connection's torn-down state",
    );
  }
}

/** Names Topic's one absence once, at boot, rather than leaving it inferred. */
export class LoggedWorkerTopicAbsence extends WorkerTopicAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerTopicAbsence {
    return new LoggedWorkerTopicAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutClusteringModels(): void {
    this.logger.warn(
      { reason: "no-model-provider-cascade" },
      "worker composed topic clustering without a model resolver: the schedule, its commands and its projections are live, and every clustering page refuses by name rather than naming a customer's topics with a provider they did not choose",
    );
  }
}

export class LoggedWorkerModelProviderAbsence extends WorkerModelProviderAbsenceReportPort {
  static create(logger: Pick<Logger, "warn" | "info">): LoggedWorkerModelProviderAbsence {
    return new LoggedWorkerModelProviderAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn" | "info">) {
    super();
  }

  withoutModelGateway(reason: "no-encryption" | "no-tenancy"): void {
    this.logger.warn(
      { reason },
      "worker composed no model gateway: topic clustering and online evaluation both refuse by name, because neither can read the project's own model provider",
    );
  }

  withoutModelTranslation(): void {
    this.logger.info(
      { reason: "no-execution-proxy" },
      "worker composed the model gateway without a translation model: this process serves no transport that translates, and a translation executes against the NLP engine's proxy address it does not join",
    );
  }

  withoutConnectionWindows(): void {
    this.logger.warn(
      { reason: "no-redis" },
      "worker composed the model gateway without the connection-test windows: the window is a shared budget and this deployment configured no Redis, so a connection test refuses rather than spending a second ceiling",
    );
  }
}

/** Names Evaluation's one absence once, at boot, rather than leaving it inferred. */
export class LoggedWorkerEvaluationAbsence extends WorkerEvaluationAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerEvaluationAbsence {
    return new LoggedWorkerEvaluationAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutEvaluatorExecution(): void {
    this.logger.warn(
      { reason: "no-online-evaluation-executor" },
      "worker composed the evaluation pipeline without an evaluator executor: evaluations reported by a customer are folded, rolled up and alerted on, and evaluations LangWatch would run itself refuse by name",
    );
  }

  withoutExecutionReceiptLedger(): void {
    this.logger.warn(
      { reason: "no-execution-receipt-ledger" },
      "worker composed the online evaluation path without a durable execution receipt: a redelivery after a crash calls the evaluator again, while the cost row stays single because the recorder derives its id from the operation key",
    );
  }
}

/**
 * No graph vertical, so Evaluation's graph-alert subscriber has nothing to re-evaluate against.
 * Reached only where `BASE_HOST` is unset, which is the same condition that already refuses every
 * outbound delivery: a graph alert that fired here could not be sent anywhere.
 */
class AbsentEvaluationGraphActivity extends AutomationGraphActivityPort {
  async getActiveGraphTriggersForProject(): Promise<[]> {
    return [];
  }

  evaluateGraphTrigger(input: { triggerId: string }): Promise<never> {
    return Promise.reject(
      new Error(
        `This process cannot evaluate graph automation ${input.triggerId}: it composed no outbound delivery, so no alert it raised could be sent.`,
      ),
    );
  }
}

/** Names Trace's storage absence once, at boot, rather than leaving it inferred. */
export class LoggedWorkerTraceAbsence extends WorkerTraceAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerTraceAbsence {
    return new LoggedWorkerTraceAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutBroadcast(): void {
    this.logger.warn(
      { reason: "no-tenant-broadcast" },
      "worker composed trace processing without a tenant broadcast bridge: both broadcast subscribers stay registered and inert, so an open trace list will not update until it is reloaded",
    );
  }
}

/**
 * The trigger-match recorder a non-consuming graph gets.
 */
class AbsentTraceTriggerMatches extends AutomationTriggerMatchRecorderPort {
  async send(): Promise<void> {
    throw new Error("Trace processing recorded a trigger match, but Automation is not composed.");
  }
}

class WorkerFeatureAppsInstaller implements WorkerFeatureInstallerPort {
  readonly name = "feature-apps";
  readonly #apps: readonly { start(): Promise<void> }[];

  constructor(...apps: { start(): Promise<void> }[]) {
    this.#apps = apps;
  }

  async install() {
    for (const app of this.#apps) await app.start();
    return void 0;
  }
}
