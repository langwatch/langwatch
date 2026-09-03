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
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  type AgentSandboxKeyReapDatabase,
  PostgresAgentSandboxKeyReapAdapter,
} from "@langwatch/api-key-server";
import {
  type AuthzGrantPipelineDatabase,
  PostgresAuthzPipelineAdapter,
} from "@langwatch/authz-server";
import {
  type GithubBranchDemandDatabase,
  type GithubBranchMaintenanceDatabase,
  PostgresGithubBranchDemandAdapter,
  PostgresGithubBranchMaintenanceAdapter,
} from "@langwatch/github-server";
import {
  type IdentityPipelineDatabase,
  type JoinRequestPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  PostgresJoinRequestPipelineAdapter,
  PostgresScimSyncPipelineAdapter,
  PostgresSsoConnectionPipelineAdapter,
  type SsoConnectionPipelineDatabase,
  type ScimSyncPipelineDatabase,
} from "@langwatch/identity-eventing";
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
  type BillingReportingDatabase,
  type BillingTenantOrganizationDatabase,
} from "@langwatch/enterprise-billing-server";
import { ClickHouseExperimentRunProcessingAdapter } from "@langwatch/experiment-server";
import {
  type CodingAgentActivityDatabase,
  PostgresCodingAgentActivityAdapter,
  PostgresGovernanceInternalProjectAdapter,
  ProjectOldestTeamPort,
} from "@langwatch/project-server";
import { ClickHouseSuiteRunProcessingAdapter } from "@langwatch/suite-server";
import {
  TopicServerInstaller,
  type TopicClusteringDatabase,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import {
  TraceCanonicalisationService,
  TraceProcessingInstallerPort,
} from "@langwatch/trace-server";
import { ApiKeyWorkerFeatureInstaller } from "../features/api-key/api-key-worker-feature.installer";
import { AuthzWorkerFeatureInstaller } from "../features/authz/authz-worker-feature.installer";
import {
  AutomationWorkerFeatureInstaller,
  type AutomationWorkerCapability,
} from "../features/automation/automation-worker-feature.installer";
import { BillingReportingWorkerFeatureInstaller } from "../features/billing/billing-reporting-worker-feature.installer";
import { CodingAgentWorkerFeatureInstaller } from "../features/coding-agent/coding-agent-worker-feature.installer";
import {
  EvaluationWorkerFeatureInstaller,
  type EvaluationWorkerCapability,
} from "../features/evaluation/evaluation-worker-feature.installer";
import {
  EventingMaintenanceWorkerFeatureInstaller,
  WorkerBlobSweepPort,
} from "../features/eventing-maintenance/eventing-maintenance-worker-feature.installer";
import { ExperimentWorkerFeatureInstaller } from "../features/experiment/experiment-worker-feature.installer";
import {
  GatewaySpendWorkerFeatureInstaller,
  type GatewaySpendWorkerCapability,
} from "../features/gateway/gateway-spend-worker-feature.installer";
import { LangyConversationWorkerFeatureInstaller } from "../features/langy/langy-conversation-worker-feature.installer";
import { LangyMaintenanceWorkerFeatureInstaller } from "../features/langy/langy-maintenance-worker-feature.installer";
import { GithubWorkerFeatureInstaller } from "../features/github/github-worker-feature.installer";
import {
  GovernanceEventsWorkerFeatureInstaller,
  type GovernanceEventsWorkerCapability,
} from "../features/governance/governance-events-worker-feature.installer";
import {
  GovernanceIngestionWorkerFeatureInstaller,
  type GovernanceIngestionWorkerCapability,
} from "../features/governance/governance-ingestion-worker-feature.installer";
import { LogWorkerFeatureInstaller } from "../features/log/log-worker-feature.installer";
import { MetricWorkerFeatureInstaller } from "../features/metric/metric-worker-feature.installer";
import { ScenarioWorkerFeatureInstaller } from "../features/scenario/scenario-worker-feature.installer";
import { SuiteWorkerFeatureInstaller } from "../features/suite/suite-worker-feature.installer";
import { IdentityWorkerFeatureInstaller } from "../features/identity/identity-worker-feature.installer";
import {
  AbsentJoinRequestMail,
  JoinRequestMailAdapter,
} from "../features/identity/join-request-mail.adapter";
import { JoinRequestWorkerFeatureInstaller } from "../features/identity/join-request-worker-feature.installer";
import { ScimSyncWorkerFeatureInstaller } from "../features/identity/scim-sync-worker-feature.installer";
import {
  SsoConnectionWorkerFeatureInstaller,
  type SsoConnectionWorkerCapability,
} from "../features/identity/sso-connection-worker-feature.installer";
import { TopicWorkerFeatureInstaller } from "../features/topic/topic-worker-feature.installer";
import { TraceWorkerFeatureInstaller } from "../features/trace/trace-worker-feature.installer";
import type { WorkerConfig } from "../platform/config/worker.config";
import {
  WorkerEventingRuntime,
  type WorkerEventingConsumerOptions,
  type WorkerEventingProductionOptions,
} from "../platform/eventing/worker-eventing.runtime";
import {
  WorkerInfrastructureAdapter,
  type WorkerInfrastructureAdapterOptions,
} from "../platform/infrastructure/worker-foundation.adapter";
import {
  WorkerLifecyclePort,
  WorkerTransportPort,
} from "../platform/lifecycle/worker-runtime.port";
import { WorkerRuntime } from "../platform/lifecycle/worker.runtime";
import type { WorkerFeatureInstallerPort } from "../features/worker-feature.installer";
import { WorkerApplication } from "./worker.application";
import type { DatasetContentDatabase } from "@langwatch/dataset-server";
import {
  AutomationGraphActivityPort,
  AutomationTriggerMatchRecorderPort,
  PostgresAutomationTraceTriggerCatalogueAdapter,
  type AutomationGraphActivityDatabase,
  type AutomationTraceTriggerCatalogueDatabase,
} from "@langwatch/automation-server";
import { ExperimentEventingAdapter } from "@langwatch/experiment-server";
import {
  ClickHouseTraceStoredSpanReaderAdapter,
  TraceProcessingServerInstaller,
} from "@langwatch/trace-server";
import { createWorkerAnalytics } from "./worker-analytics.composition";
import { createWorkerGovernanceIngestion } from "./worker-governance-ingestion.composition";
import type { IngestionPullLifecycleDatabase } from "@langwatch/enterprise-governance-server";
import {
  createWorkerTopicRuntime,
  WorkerTopicAbsenceReportPort,
} from "./worker-topic-clustering.composition";
import {
  tryCreateWorkerModelProviders,
  WorkerModelProviderAbsenceReportPort,
} from "./worker-model-provider.composition";
import {
  tryCreateWorkerTenancy,
  WorkerTenancyAbsenceReportPort,
} from "./worker-tenancy.composition";
import {
  createWorkerEvaluationProcessing,
  WorkerEvaluationAbsenceReportPort,
} from "./worker-evaluation-processing.composition";
import type { WorkerFeatureFlagDatabase } from "./worker-feature-flags.composition";
import type { WorkerProjectStorageDatabase } from "./worker-object-storage.composition";
import type { WorkerTraceCapabilityDatabase } from "./worker-trace-capability-services.composition";
import { createWorkerDatasetNormalization } from "./worker-dataset-normalization.composition";
import { createWorkerFeatureFlags } from "./worker-feature-flags.composition";
import { createWorkerGovernanceRollups } from "./worker-governance-rollups.composition";
import { createWorkerObjectStorage } from "./worker-object-storage.composition";
import { createWorkerSpanStorage } from "./worker-span-storage.composition";
import { WorkerCodingAgentTraceProcessingAdapter } from "../features/coding-agent/coding-agent-trace-processing.adapter";
import {
  tryCreateWorkerAutomationGraphComposition,
  resolveWorkerStoredSecretCipher,
  WorkerAutomationClock,
  tryCreateWorkerAutomationDelivery,
} from "./worker-automation-graph.composition";
import {
  createWorkerAutomationSettlement,
  WorkerAutomationSettlementAbsenceReportPort,
} from "./worker-automation-settlement.composition";
import {
  WorkerAutomationHeartbeat,
  WorkerAutomationSettlementEvaluationReader,
  WorkerAutomationSettlementTraceReader,
} from "./worker-automation-settlement-reads.composition";
import { createWorkerTraceSpool } from "./worker-trace-blob.composition";
import { tryCreateWorkerTraceBroadcast } from "./worker-trace-broadcast.composition";
import { tryCreateWorkerTenantBroadcast } from "./worker-tenant-broadcast.composition";
import {
  createWorkerLangyConversation,
  WorkerLangyAbsenceReportPort,
  type WorkerLangyConversationDatabase,
} from "./worker-langy-conversation.composition";
import { tryCreateWorkerLangyTitleModel } from "./worker-langy-title-model.composition";
import {
  createWorkerScenarioProcessing,
  WorkerScenarioAbsenceReportPort,
} from "./worker-scenario-processing.composition";
import {
  createWorkerGatewaySpend,
  WorkerGatewaySpendAbsenceReportPort,
} from "./worker-gateway-spend.composition";
import {
  createWorkerWebhookEgress,
  createWorkerWebhookTransport,
} from "./worker-webhook-egress.composition";
import { createWorkerTraceCapabilityServices } from "./worker-trace-capability-services.composition";
import { createWorkerTraceProductAnalytics } from "./worker-trace-product-analytics.composition";
import { createWorkerTraceProjectionStores } from "./worker-trace-projection-stores.composition";
import {
  WorkerTraceProcessingPipeline,
  type WorkerTraceProcessingCommands,
} from "./worker-trace-processing-pipeline.composition";
import { createWorkerTrackedEvents } from "./worker-tracked-event.composition";
import {
  tryCreateWorkerMailComposition,
  type WorkerMailComposition,
} from "./worker-mail.composition";

/** The worker-owned runtime dependencies for the Topic feature. */
export type WorkerTopicCompositionOptions = {
  database: TopicServerInstallerDependencies["database"];
  redis: TopicServerInstallerDependencies["redis"];
  execution: TopicServerInstallerDependencies["execution"];
  metrics: TopicServerInstallerDependencies["metrics"];
};

/**
 * Reports the composition decisions Trace's own storage would otherwise hide.
 *
 * Both are decisions a deployment should read in its own logs at boot rather
 * than infer from work that quietly never completes.
 */
export abstract class WorkerTraceAbsenceReportPort {
  /** No pub/sub bridge: the two broadcast subscribers register and stay inert. */
  abstract withoutBroadcast(): void;

  /** Azure object storage: dataset normalization has no backend in this process. */
  abstract withoutDatasetStorage(): void;
}

/**
 * The one Prisma client this process opened.
 *
 * Optional only while the platform root still composes this graph. That root
 * hands its client over inside `topic` — `TopicClusteringDatabase` IS a
 * `PrismaClient` — and a process opens exactly one, so the fallback below names
 * the same object an explicit option would. Naming it here is what lets a
 * feature that is not Topic compose its own Postgres adapter without reading
 * another feature's option, and the fallback goes when the platform root does.
 */
export type WorkerDatabaseCompositionOptions = AgentSandboxKeyReapDatabase &
  IngestionPullLifecycleDatabase &
  SsoConnectionPipelineDatabase &
  TopicClusteringDatabase &
  AuthzGrantPipelineDatabase &
  AutomationGraphActivityDatabase &
  AutomationTraceTriggerCatalogueDatabase &
  BillingReportingDatabase &
  BillingTenantOrganizationDatabase &
  CodingAgentActivityDatabase &
  DatasetContentDatabase &
  GithubBranchDemandDatabase &
  GithubBranchMaintenanceDatabase &
  IdentityPipelineDatabase &
  JoinRequestPipelineDatabase &
  LangySessionKeyReapDatabase &
  WorkerLangyConversationDatabase &
  ScimSyncPipelineDatabase &
  WorkerFeatureFlagDatabase &
  WorkerProjectStorageDatabase &
  WorkerTraceCapabilityDatabase;

/**
 * The ONE identity ledger this graph still RECEIVES (ADR-101).
 *
 * The other three — `identity`, `scim-sync` and `join-requests` — are composed
 * below from `@langwatch/identity-eventing`'s Postgres seams, because every
 * dependency they take is either a Postgres binding or the mail gateway this
 * process now owns. The connection ledger is not: its teardown port revokes a
 * torn-down connection's directory tokens through the SCIM service, and no
 * directory service exists as something this process can compose, so its
 * definition still comes from the application that has one.
 *
 * Optional, like every group the legacy registry still owns. A graph without
 * it routes three of the four identity ledgers and must not claim
 * `event-sourcing/jobs`; that rule is the composition root's
 * (`createWorkerDurableComposition` asks for no consumers), and the parity
 * guard is what proves the packaged consumer routes all four.
 */
/**
 * Reports the composition decision an absent GitHub App would otherwise hide.
 *
 * The sweep mounts either way: its retention half is a DELETE over rows this
 * process wrote and needs no App at all. What changes without credentials is
 * that the recheck half asks GitHub nothing, and a deployment should read that
 * in its own logs at boot rather than infer it from a sweep that quietly
 * answers zero forever.
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
 *
 * `EventingServerRuntimeOptions.consumersEnabled` is omitted from both arms
 * below in its favour, so the graph has one place that decides whether it
 * claims `event-sourcing/jobs` rather than two that could disagree.
 */
type WorkerEventingConsumerCompositionOptions = {
  consumers?: WorkerEventingConsumerOptions;
};

type WorkerProductionCompositionBaseOptions = {
  config: WorkerConfig;
  lifecycle: WorkerLifecyclePort;
  transport: WorkerTransportPort;
  /** The one Prisma client this process opened. */
  database: WorkerDatabaseCompositionOptions;
  /**
   * The SAME client, as the typed connection the tenancy graph needs.
   *
   * Two names for one object, and it is worth being exact about why rather
   * than folding them: `database` above is the structural intersection every
   * feature narrows for itself, which is what lets a composition test hand in
   * the delegates it exercises and nothing else. `PostgresOrganizationAdapter`
   * and `PostgresProjectAdapter` do not take a structural type — both declare
   * `database: PrismaClient` — so the tenancy graph is the one thing here that
   * needs the generated client itself, passed through with no cast.
   *
   * Optional because it can genuinely be absent: a graph composed without it
   * composes no tenancy, no model gateway and no title model, and each says so
   * by name. `WorkerStandaloneComposition` always supplies it.
   */
  connection?: PrismaConnection;
  /**
   * Pipeline groups whose features have moved out of the legacy registry.
   * Each stays optional until every group in Wave 4 has landed: the shared
   * `event-sourcing/jobs` queue still belongs to the legacy worker, so an
   * incomplete graph must be composable without pretending to be complete.
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
 * Fully composed background-worker graph for extractable worker surfaces.
 *
 * The shared Eventing consumer is off unless the caller asks for it. A
 * consumer must be able to route the complete Eventing job registry,
 * including Trace's `assignTopic` pipeline consumer, before it can safely
 * claim `event-sourcing/jobs`: the queue rejects an unroutable job for
 * redelivery rather than dropping it, so a graph missing one handler stalls
 * that handler's work while every health signal stays green. Only a caller
 * that has mounted the complete registry may pass `eventing.consumers`.
 */
export class WorkerProductionComposition {
  static create(options: WorkerProductionCompositionOptions): WorkerProductionComposition {
    const infrastructure = options.infrastructure
      ? WorkerInfrastructureAdapter.create({
          ...options.infrastructure,
          resources: options.resources,
        })
      : undefined;
    const eventingOptions = createEventingPersistence(options, infrastructure);
    // The one Redis this process opened, named once.
    //
    // A worker that composed its own foundation has it there; one handed an
    // already-built substrate reads the queue's. They are the same connection
    // either way, and naming it once is what stops a feature reaching for a
    // second: two connections would give one process two fold caches, two
    // dedup keyspaces and two tenant broadcast channels.
    const processRedis = infrastructure?.redis ?? eventingOptions.groupQueue.redis;
    const mail = tryCreateWorkerMailComposition({
      config: options.config,
      ...(infrastructure ? { aws: infrastructure.aws } : {}),
      ...(options.resources ? { resources: options.resources } : {}),
    });
    // One fenced outbound sender for the whole process: an automation's webhook
    // alert and a webhook endpoint's delivery count against the same ceiling
    // and answer to the same address policy.
    const webhookEgress = createWorkerWebhookEgress({
      config: options.config,
      redis: eventingOptions.groupQueue.redis,
    });
    WorkerProductionComposition.requireMailForConsumers({
      mail,
      consumers: options.eventing.consumers,
      resources: options.resources,
    });

    // The SaaS billable-events meter and the dispatch subscriber that follows
    // it, built HERE rather than received. They are configured on the runtime
    // itself rather than on a pipeline, because their `global:*` queues join
    // the shared job registry the moment the first pipeline registers — so the
    // pair has to exist before any feature mounts, and the sender its
    // subscriber calls is produced by a pipeline this same composition
    // registers afterwards. That circle is why the dispatch is resolved
    // lazily, from the reporting installer named below.
    //
    // Gated on this process's own deployment leaf, read from the one variable
    // the App reads: the pair's routing keys share `event-sourcing/jobs` with
    // every pipeline's, so a consumer that has them where the producer does
    // not meters a self-hosted install, and one that lacks them where the
    // producer has them rejects every billable span, evaluation, experiment
    // and simulation event for redelivery forever.
    // A SaaS worker that metered without composing the pipeline its reports
    // are sent through would count every billable event correctly and report
    // none of them — revenue that is present in ClickHouse, absent from
    // Stripe, and visible nowhere else. This graph composes that pipeline
    // itself, unconditionally, so the pairing is structural rather than
    // checked; what is left to get wrong is ORDER, and the guard below is what
    // says so — the meter is configured on the runtime's construction, which
    // is before any installer exists.
    let billingReportingInstaller: BillingReportingWorkerFeatureInstaller | undefined;
    const saasMeter = options.config.deployment.saas
      ? saasBillableEventsMeter({
          database: options.database,
          redis: eventingOptions.groupQueue.redis,
          resolveClickHouseClient: options.eventing.resolveClickHouseClient,
          getDispatch: () => {
            if (!billingReportingInstaller) {
              throw new Error(
                "SaaS billable-events metering is composed without the billing reporting pipeline; the meter has no sender.",
              );
            }
            return billingReportingInstaller.commands.reportUsageForMonth;
          },
        })
      : undefined;

    const eventing = WorkerEventingRuntime.createProduction({
      persistence: eventingOptions,
      warnWhenProjectionsRunInline: options.config.nodeEnvironment === "production",
      ...(saasMeter ? { configureGlobalProjections: saasMeter } : {}),
      ...(options.eventing.consumers ? { consumers: options.eventing.consumers } : {}),
    });
    // Unconditional, like every other substrate sweep below: both halves are
    // composed from this package over objects this process already holds. The
    // blob pass needs the queue's OWN Redis — the sweeper walks the keyspace
    // the Group Queue offloads payloads into, so a second connection to a
    // different Redis would report an empty sweep rather than fail — and the
    // metrics adapter is Eventing's own, because this process has no
    // prom-client registry to lend it and writes the same two series names
    // over OTLP that the App writes through its registry.
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
      sandboxKeyReap: PostgresAgentSandboxKeyReapAdapter.create({
        database: options.database,
      }).build(),
    });
    // Stateless derivation over one span or log record: it reads nothing and
    // holds nothing, so this graph builds its own rather than taking the App's.
    // One instance, because the coding-agent fold and the Log pipeline's
    // dispatch subscriber ask it the same questions.
    const traceCanonicalisation = TraceCanonicalisationService.create();
    // Unconditional, on the same footing as the API-key sweep: the sweep is
    // composed from this package and the feature's own service, so there is no
    // graph in which it is present but unbuildable. Credentials are a different
    // question from composition — without them the recheck half asks GitHub
    // nothing and the retention half keeps working — so their absence is
    // reported by name rather than silently mounting a half-sweep.
    const githubConfig = options.config.github;
    if (!githubConfig.appId || !githubConfig.privateKey) {
      WorkerProductionComposition.githubAbsence(options)?.withoutAppCredentials();
    }
    const github = GithubWorkerFeatureInstaller.create({
      eventing,
      branchMaintenance: PostgresGithubBranchMaintenanceAdapter.create({
        database: options.database,
        config: {
          appId: githubConfig.appId ?? "",
          privateKey: githubConfig.privateKey ?? "",
        },
        redis: processRedis,
        ...(githubConfig.host ? { hostConfig: { host: githubConfig.host } } : {}),
      }).build(),
    });
    // Unconditional, on the same footing as the sweeps above: every dependency
    // is composed from a feature package over substrates this process already
    // holds — the tenant-keyed ClickHouse client the event store resolves
    // through, the queue's own Redis, and the one Prisma client this process
    // opened. So there is no graph in which it is present but unbuildable.
    //
    // Two of its collaborators used to be why nothing outside the App could
    // build it, and neither is a service graph after all. Session cost is
    // priced from the platform's immutable model catalog — the identical pure
    // function `ModelProviderService.estimateCost` calls, over the identical
    // static rates, with per-tenant overrides still travelling on the span
    // attributes — so the App's provider stack was never being asked anything.
    // And the project write is one throttled `UPDATE` of one column, behind a
    // one-method port, rather than the whole `ProjectService`.
    //
    // The pull-request mapping subscriber gets the GitHub demand half composed
    // from this process's own database, on the same credentials the sweep
    // above uses and with the same declared absence when there are none:
    // without an App the mapping call resolves no installation and maps
    // nothing, exactly as the recheck half asks GitHub nothing. It is passed
    // unconditionally because it is what registers `reactor:pullRequestMapping`
    // — a consumer that composed the pipeline without it would route one key
    // fewer than the producer stages, and the queue rejects an unroutable job
    // for redelivery rather than dropping it.
    const codingAgentActivity = PostgresCodingAgentActivityAdapter.create({
      database: options.database,
    }).build();
    const codingAgent = CodingAgentWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseCodingAgentProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        redis: eventingOptions.groupQueue.redis,
        traceCanonicalisation,
        projectActivity: codingAgentActivity,
        pullRequestMapping: PostgresGithubBranchDemandAdapter.create({
          database: options.database,
          config: {
            appId: githubConfig.appId ?? "",
            privateKey: githubConfig.privateKey ?? "",
          },
          redis: processRedis,
          ...(githubConfig.host ? { hostConfig: { host: githubConfig.host } } : {}),
          project: codingAgentActivity,
        }).build(),
        ...(options.config.eventing.foldCacheTtlSeconds === undefined
          ? {}
          : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      }),
    });
    // The Gateway spend spine and the Governance signal log, composed here
    // rather than received, and composed as ONE pair.
    //
    // UNCONDITIONAL, on the same footing as every other pipeline this process
    // now owns: ten of the shared registry's routing keys are theirs, and a
    // consumer that claimed `event-sourcing/jobs` without them would leave
    // every spend command, every budget debit and every webhook delivery
    // redelivering forever while the pods stayed up.
    //
    // The governance installer is built FIRST, because the spend graph's debit
    // process appends through its two commands and receives them as the
    // installer's own late-bound proxies. Ordering is enforced again at install
    // time by `orderedFeatureInstallers`.
    const gatewayAbsence = WorkerProductionComposition.gatewayAbsence(options);
    const governanceEventsInstaller = GovernanceEventsWorkerFeatureInstaller.create({
      installer: { buildProcessing: () => gatewaySpendGraph.governance.buildProcessing() },
      eventing,
    });
    const gatewaySpendGraph = createWorkerGatewaySpend({
      config: options.config,
      database: options.database as never,
      resolveClickHouseClient: options.eventing.resolveClickHouseClient,
      redis: eventingOptions.groupQueue.redis,
      ...(options.config.eventing.foldCacheTtlSeconds === undefined
        ? {}
        : { foldCacheTtlSeconds: options.config.eventing.foldCacheTtlSeconds }),
      processStore: eventing.processStore,
      egress: webhookEgress,
      governanceCommands: {
        recordVkLifecycle: (data) => governanceEventsInstaller.commands.recordVkLifecycle(data),
        recordBudgetCrossing: (data) =>
          governanceEventsInstaller.commands.recordBudgetCrossing(data),
      },
      ...(gatewayAbsence ? { absence: gatewayAbsence } : {}),
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    const governanceEvents = governanceEventsInstaller;
    const gatewaySpend = GatewaySpendWorkerFeatureInstaller.create({
      installer: gatewaySpendGraph.spend,
      eventing,
    });
    // Unconditional, on the same footing as the sweeps above: both pipelines
    // are composed from their own feature package over the tenant-keyed
    // ClickHouse client this graph already resolves its event store through,
    // so there is no graph in which they are present but unbuildable.
    //
    // `retention.defaultRetentionDays` is the number the event store already
    // stamps rows with, read once here rather than configured a second time,
    // and the two shard counts come from the same environment variables the
    // App reads (worker.config `processing`) so producer and consumer clamp a
    // lane count identically.
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
    // Unconditional, on the same footing as metric and log: the pipeline is
    // composed from its own feature package over the tenant-keyed ClickHouse
    // client this graph already resolves its event store through, so there is
    // no graph in which it is present but unbuildable.
    //
    // The fold cache rides `eventingOptions.groupQueue.redis` — the one Redis
    // this process's queue substrate runs on, rather than a second connection
    // — because the cache is not optional here: it carries the applied-event
    // ids a redelivered item is dropped on, and the run-state fold accumulates
    // by addition. Its TTL comes from the same variable the App reads, so the
    // two graphs cannot expire each other's entries early.
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
    // Unconditional, on the same footing as suite above: the pipeline is
    // composed from its own feature package over the tenant-keyed ClickHouse
    // client this graph already resolves its event store through, so there is
    // no graph in which it is present but unbuildable.
    //
    // The fold cache rides `eventingOptions.groupQueue.redis` — the one Redis
    // this process's queue substrate runs on, rather than a second connection
    // — because the cache is not optional here either: it carries the
    // applied-event ids a redelivered result is dropped on, and the run-state
    // fold accumulates by addition across every target and evaluator result.
    // Its TTL comes from the same variable the App reads, so the two graphs
    // cannot expire each other's entries early.
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
    // TRACE, COMPOSED HERE RATHER THAN RECEIVED. This is the conversion the
    // step-(g) attempt halted on: the pipeline definition, `command:recordSpan`
    // and all fifteen subscriber handlers are now built from substrates this
    // process holds — the one Prisma client, the queue's Redis, the tenant-keyed
    // ClickHouse client, this deployment's own variables and its object storage
    // — plus the command proxies the sibling installers publish above.
    //
    // It is UNCONDITIONAL, and it has to be: `trace_processing` owns
    // twenty-nine of the shared registry's routing keys, and a consumer that
    // claimed `event-sourcing/jobs` without them would leave every kind of
    // trace work redelivering forever while the pods stayed up.
    const traceDatabase = options.database;
    const traceAbsence = WorkerProductionComposition.traceAbsence(options);
    const objectStorage = createWorkerObjectStorage({
      config: options.config,
      database: traceDatabase,
      ...(options.resources ? { resources: options.resources } : {}),
    });
    const traceServices = createWorkerTraceCapabilityServices({ database: traceDatabase });
    const traceFeatureFlags = createWorkerFeatureFlags({
      database: traceDatabase,
      config: options.config,
      redis: eventingOptions.groupQueue.redis,
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
    if (options.config.infrastructure.storage.backend === "azure") {
      traceAbsence?.withoutDatasetStorage();
    }
    // The tenancy graph: the organization, project and permission services,
    // composed ONCE from the typed client and handed to every consumer that
    // derives a scope. It is built above the model gateway because the gateway
    // takes it whole, and above nothing else that would care about the order.
    const tenancy = tryCreateWorkerTenancy({
      connection: options.connection,
      encryption: resolveWorkerStoredSecretCipher(options.config),
      redis: processRedis,
      config: options.config,
      ...(WorkerProductionComposition.tenancyAbsence(options)
        ? { absence: WorkerProductionComposition.tenancyAbsence(options)! }
        : {}),
      ...(options.observability ? { logger: options.observability.logger } : {}),
    });
    // The model gateway, composed once for every path in this process that
    // resolves a customer's model: topic clustering's four questions and an
    // online evaluation's `X_LITELLM_*` environment. Two gateways would be two
    // decryptions of one stored credential and two answers to which model a
    // project clusters with, so it is built here and handed down.
    //
    // The cipher is the SAME `resolveWorkerStoredSecretCipher` the three other
    // stored-secret verticals read under — a provider credential is written by
    // the control plane under `CREDENTIALS_SECRET` — and its absence is a gate
    // rather than a degradation, because a gateway that could not decrypt would
    // report every configured provider as unusable instead of failing honestly.
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
      // asks of a project directory — the wide `ProjectService` the tenancy
      // graph now composes satisfies the same reads, and this path deliberately
      // asks for no more than it uses.
      projects: traceServices.projects,
      nlpServiceUrl: options.config.infrastructure.modelProvider.nlpServiceUrl,
    });
    // Langy's conversation pipeline, composed here rather than received.
    //
    // UNCONDITIONAL, on the same footing as trace processing: the pipeline owns
    // twenty-four of the shared registry's routing keys, its two operational
    // folds are Postgres, and there is no deployment in which those keys are
    // meaningless. What varies is whether this process can reach an agent
    // manager, generate a title or mint a recovery session key, and each of
    // those is reported by name rather than inferred from work that never
    // completes.
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
    // The simulation-run pipeline, composed here rather than received.
    //
    // It is built AFTER the trace projection stores because its metrics command
    // reads the trace summary fold this process already composes — one store,
    // one cache prefix, one applied-event-id set. Install ORDER is unchanged
    // and still lives in `orderedFeatureInstallers`: Suite registers before
    // Scenario because the simulation process reports item starts and
    // completions into a suite run.
    const scenarioAbsence = WorkerProductionComposition.scenarioAbsence(options);
    const scenario = ScenarioWorkerFeatureInstaller.create({
      installer: createWorkerScenarioProcessing({
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
        ...(scenarioAbsence ? { absence: scenarioAbsence } : {}),
      }),
      eventing,
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
    // Automation's settlement half, composed here rather than received.
    //
    // UNCONDITIONAL, and it installs FIRST: `command:recordTriggerMatch` is the
    // durable write every trigger match from trace, evaluation and governance
    // lands in, and `subscriber:pm:triggerSettlement` is what turns those
    // matches into one notification per window. A consumer that claimed
    // `event-sourcing/jobs` without the pair would leave every match
    // redelivering forever.
    //
    // Its other two process managers — the 30-second graph-alert sweep and the
    // webhook delivery-log prune — register NO routing key, because a
    // schedule-only definition declares no event types. They still wake here,
    // so their collaborators are composed rather than refused.
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
    });
    const automationClock = new WorkerAutomationClock();
    const automationAbsence = WorkerProductionComposition.automationAbsence(options);
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
    });
    // Evaluation's durable pipeline, composed here rather than received.
    //
    // It is built AFTER Automation and BEFORE the trace producer check because
    // its two terminal subscribers dispatch through Automation's own recorder
    // and re-evaluate through the graph vertical composed above, while Trace's
    // evaluation trigger dispatches into the commands this installer produces.
    // Installation order is the registry's and is unchanged: Evaluation still
    // installs before Trace, Metric and Log.
    const evaluationTriggerCatalogue = PostgresAutomationTraceTriggerCatalogueAdapter.create({
      prisma: traceDatabase,
      clock: automationClock,
    });
    const evaluation = EvaluationWorkerFeatureInstaller.create({
      installer: createWorkerEvaluationProcessing({
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
    const experimentIdLookup = ExperimentEventingAdapter.createIdLookup({
      resolveClient: options.eventing.resolveClickHouseClient,
      clickhouseEnabled: true,
    });
    const traceProducers = WorkerProductionComposition.requireTraceProducers({
      automation,
      evaluation,
      scenario,
      consumers: options.eventing.consumers,
    });
    const trace = TraceWorkerFeatureInstaller.create({
      installer: TraceProcessingServerInstaller.create({
        pipeline: WorkerTraceProcessingPipeline.create({
          config: options.config,
          services: traceServices,
          featureFlags: traceFeatureFlags,
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
            spans: ClickHouseTraceStoredSpanReaderAdapter.create({
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
    const topicServer = TopicServerInstaller.create({
      database: topicRuntime.database,
      processStore: eventing.processStore,
      redis: topicRuntime.redis,
      execution: topicRuntime.execution,
      metrics: topicRuntime.metrics,
    });
    const topic = TopicWorkerFeatureInstaller.create({
      installer: topicServer,
      eventing,
      traceAssignments: trace.traceAssignments,
    });
    // UNCONDITIONAL, like the two pipelines around it. `pulled_usage_processing`
    // and `ingestion_pull_processing` carry eight routing keys between them in
    // the checked-in `job-registry.json`, and the queue rejects an unroutable
    // job for redelivery rather than dropping it — so a graph that mounted the
    // rest and left these out would stall every configured customer's usage
    // pull forever with the pods up and the queue depth simply growing.
    //
    // Every collaborator is one this process already holds: its Prisma client,
    // its tenant-keyed ClickHouse resolver, its AWS client runtime, its
    // feature-flag store and the one cipher both halves of Automation already
    // read the App's stored secrets with.
    const governanceIngestion = GovernanceIngestionWorkerFeatureInstaller.create({
      installer: createWorkerGovernanceIngestion({
        config: options.config,
        database: options.database,
        resolveClickHouseClient: options.eventing.resolveClickHouseClient,
        projects: PostgresGovernanceInternalProjectAdapter.create({
          database: options.database as never,
          teams: PrismaGovernanceOldestTeamAdapter.create(options.database),
        }).build(),
        featureFlags: traceFeatureFlags,
        aws: objectStorage.aws,
        encryption: resolveWorkerStoredSecretCipher(options.config),
        ...(options.observability ? { logger: options.observability.logger } : {}),
      }),
      eventing,
    });
    // Unconditional, exactly as the legacy registry registers it, and for the
    // same reason the sweeps above are: every dependency is composed from this
    // package over substrates this process already holds. The roll-up is a
    // command-only pipeline — no projections, no subscribers — so on a
    // self-hosted install nothing dispatches into it; registering it either
    // way is what keeps producer and consumer routing one key set off the
    // shared `event-sourcing/jobs` queue.
    //
    // The ClickHouse read is asked for by ORGANIZATION, which the tenant-keyed
    // resolver answers because the routing directory treats an organization id
    // as a tenant of itself — the same equivalence the meter rides. Asking for
    // the project instead would still return a client and still count, off the
    // shared instance, for a customer whose data is on their own cluster.
    //
    // The organization cache rides the queue's one Redis under the prefix and
    // lifetime the App's own `TtlCache` uses, so neither graph expires the
    // other's entries early or reads a cache the other never writes.
    //
    // The Stripe sender is the half that IS deployment-shaped, and it is built
    // on the same leaf the App builds its own on: a SaaS process resolves one
    // and refuses without a key — the refusal `AppStripeRuntime.create`
    // already makes — while a self-hosted process composes none at all, which
    // is what `usageReportingService` is on the App side of the same install.
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
    billingReportingInstaller = billingReporting;
    // Unconditional, on the same footing as the identity ledgers below: the
    // grants ledger's CONSUMER half takes exactly two Postgres bindings — the
    // read model's guarded writer and the insert-only audit trail — over the
    // one Prisma client this process opened, so there is no graph in which it
    // is present but unbuildable. Its producer half stays with the
    // application, which is the process that writes grants.
    const authz = AuthzWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresAuthzPipelineAdapter.create({
          database: options.database,
        }).build(),
      },
      eventing,
    });
    // Unconditional, on the same footing as the sweeps and the two processing
    // pipelines above: both ledgers are composed from their own feature
    // package over the one Prisma client this process opened, so there is no
    // graph in which they are present but unbuildable.
    //
    // The identity ledger carries two-step verification on the same aggregate
    // (D06), which is why one option builds two folds: an enrollment belongs
    // to exactly the person the identifiers belong to, and sharing the
    // aggregate is what puts both in one per-person lane.
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
    // UNCONDITIONAL now, like the three ledgers around it. `sso-connections`
    // names fourteen commands, a state projection and the teardown grace
    // subscriber in the checked-in `job-registry.json`, and this is the ONLY
    // graph that can advance TEARDOWN_PENDING to TORN_DOWN — so a process that
    // claimed the queue without it would leave every requested teardown
    // pending forever with the pods up and the probe answering.
    //
    // What is absent is the DIRECTORY half, by name: a torn-down connection's
    // SCIM tokens are not deleted here, because this process composes no
    // directory capability. They stop verifying regardless — every SCIM
    // request checks the connection this fold has just moved to TORN_DOWN —
    // so what is lost is the row cleanup, not the security property.
    WorkerProductionComposition.identityAbsence(options)?.withoutDirectoryTokenRevocation();
    const ssoConnection = SsoConnectionWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresSsoConnectionPipelineAdapter.create({
          database: options.database,
          eventSourcing: eventing.eventSourcing,
          adminEmails: options.config.deployment.adminEmails,
        }).build(),
      },
      eventing,
    });
    // Composed here, on the mail capability this process now owns. Everything
    // else the join ledger takes is Postgres: the `JoinRequest` head serving
    // both the fold and its guards, and the audience its two notices are
    // addressed to.
    //
    // UNCONDITIONAL, unlike the connection ledger above. `join-requests` names
    // five commands, a state projection and the lifecycle subscriber in the
    // checked-in `job-registry.json`, and the queue rejects an unroutable job
    // for redelivery rather than dropping it — so a graph that mounted this
    // only where mail happened to be configured would stall those seven
    // forever while the pods stayed up and the queue depth simply grew.
    // Expiry is also a FOLD this graph performs: a request lapses on time
    // whether or not anybody can be told about it.
    //
    // Which leaves the mail itself as the thing that can be absent, and it is
    // absent by NAME: `AbsentJoinRequestMail` throws on every send, the
    // notification fan-out logs it, and the request stands — the behaviour a
    // deployment with no email provider already has. A process that claims
    // `event-sourcing/jobs` never reaches that state, because
    // `requireMailForConsumers` above refuses to compose it.
    const joinRequest = JoinRequestWorkerFeatureInstaller.create({
      installer: {
        pipeline: PostgresJoinRequestPipelineAdapter.create({
          database: options.database,
          eventSourcing: eventing.eventSourcing,
          mail: mail
            ? JoinRequestMailAdapter.create({
                mailer: mail.delivery,
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
      metric,
      log,
      topic,
      trace,
      suite,
      scenario,
      experiment,
      governanceIngestion,
      billingReporting,
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
   * Refuses a consuming graph that cannot send mail.
   *
   * `join-requests` names five commands, a state projection and the lifecycle
   * subscriber in the checked-in `job-registry.json`, and the queue rejects an
   * unroutable job for redelivery rather than dropping it. So a consumer that
   * mounted everything else would stall exactly those seven forever while the
   * pods stayed up, the liveness probe answered and the queue depth simply
   * grew — the failure shape every refusal in this file exists to convert into
   * a boot error.
   *
   * Mounting the pipeline WITHOUT mail is not the alternative. Its two wakes
   * are the only nudge an admin ever gets about a pending request and the only
   * notice a requester gets that theirs lapsed; a graph that folded the
   * expiry and told nobody would look identical to a working one from every
   * angle the fleet watches.
   *
   * A producer-only graph is unaffected, deliberately: it claims nothing, so
   * nothing goes unrouted, and every existing composition that never asked for
   * consumers keeps composing without a mail gateway.
   *
   * So is a graph with no resource scope, and for a narrower reason: a mail
   * gateway holds a transport, and a composition that owns no scope can close
   * nothing — so it could not hold one even where the deployment is fully
   * configured. Every root that runs as a process supplies a scope; a
   * composition without one is a partially-composed graph, and refusing it
   * would be refusing the fixture rather than the deployment.
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
   * The three producers Trace's own subscribers dispatch into.
   *
   * A GRAPH THAT CONSUMES MUST HAVE ALL THREE. `reactor:evaluationTrigger` and
   * `reactor:customEvaluationSync` send into Evaluation,
   * `reactor:simulationMetricsSync` into Scenario, and `reactor:triggerMatch`
   * into Automation. A consumer that claimed `event-sourcing/jobs` without one
   * of them would route the trace side of that work and then throw on every
   * dispatch — an online evaluation that never runs, a simulation whose metrics
   * never settle, an alert that never fires — with the queue redelivering each
   * one forever.
   *
   * A graph that does NOT consume may omit them, and that is not a loophole:
   * it composes the definition so the registry can be inspected and tested, and
   * nothing ever calls a handler. The proxies it gets refuse BY NAME rather
   * than resolving to a no-op, so a graph that started consuming without the
   * producers fails on the first dispatch instead of silently dropping it.
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

  /** The boot logger, as the one place Identity's one absence is declared. */
  private static identityAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerIdentityAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerIdentityAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The boot logger, as the one place the model gateway's absences are declared. */
  private static tenancyAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerTenancyAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerTenancyAbsence.create(options.observability.logger)
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
    metric?: MetricWorkerFeatureInstaller;
    log?: LogWorkerFeatureInstaller;
    topic: TopicWorkerFeatureInstaller;
    trace: TraceWorkerFeatureInstaller;
    suite?: SuiteWorkerFeatureInstaller;
    scenario?: ScenarioWorkerFeatureInstaller;
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
   * The installers a host wires producers against.
   *
   * Each publishes callable command proxies that refuse until the installer
   * has registered, so exposing them here is what lets a host hand a producer
   * its dispatcher before the graph starts without risking a silent drop.
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
 *
 * It reproduces the live registry's order exactly, because the order is
 * load-bearing rather than incidental:
 *
 *   automation           first — every trigger match in the trace, evaluation
 *                        and governance graphs is written through its command
 *   eventing-maintenance the substrate's own blob and retention sweeps, which
 *                        belong to no feature and must not depend on one
 *   langy-maintenance    the session-key reaper, composed from its own feature
 *                        package and so unconditional, like the substrate
 *                        sweeps it is mounted with
 *   api-key              the agent-sandbox key sweep, the same kind of
 *                        unconditional reaper, and where the legacy registry
 *                        mounts it: after Langy's, before GitHub's
 *   github               fleet-wide branch recheck, before the domain graphs
 *   evaluation           before trace, whose evaluation trigger and custom
 *                        evaluation sync dispatch its two commands
 *   coding-agent         before metric, log and trace, whose dispatch
 *                        subscribers close over its contribution commands
 *   governance-events    the pair the live registry mounts under one guard:
 *   gateway-spend        spend's debit adapter delivers through governance's
 *                        commands, and governance's webhook delivery process
 *                        has no producer without spend
 *   metric, log          before trace, because their coding-agent dispatch
 *                        subscribers feed the same contribution commands
 *   trace                before topic: Topic dispatches assignments through
 *                        Trace's canonical assignment port
 *   suite                before scenario, whose simulation process manager
 *                        reports item starts and completions into it
 *   scenario
 *   experiment           after trace, which reaches it through the
 *                        computeExperimentRunMetrics proxy rather than the
 *                        other way round
 *   langy-conversation   after experiment, before topic, which is where the
 *                        legacy registry mounts it
 *   topic
 *   governance-ingestion Enterprise pulled-usage and ingestion-pull
 *   billing-reporting
 *   authz                the grants ledger, registered after every pipeline
 *                        that can emit a grant change
 *   identity             the four ADR-101 ledgers, after AuthZ exactly as the
 *   sso-connection       legacy registry mounts them. Their relative order is
 *   scim-sync            free — none subscribes to another's events — but the
 *   join-request         group's position is not: they are the last producers
 *                        to open a durable write path
 *
 * Gaps in the middle are pipeline groups still owned by the legacy registry.
 * A group landing later slots into its documented position; nothing here
 * reorders to accommodate it.
 */
function orderedFeatureInstallers(installers: {
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
  metric?: MetricWorkerFeatureInstaller;
  log?: LogWorkerFeatureInstaller;
  trace: TraceWorkerFeatureInstaller;
  suite?: SuiteWorkerFeatureInstaller;
  scenario?: ScenarioWorkerFeatureInstaller;
  experiment?: ExperimentWorkerFeatureInstaller;
  topic: TopicWorkerFeatureInstaller;
  governanceIngestion?: GovernanceIngestionWorkerFeatureInstaller;
  billingReporting?: BillingReportingWorkerFeatureInstaller;
  authz?: AuthzWorkerFeatureInstaller;
  identity?: IdentityWorkerFeatureInstaller;
  ssoConnection?: SsoConnectionWorkerFeatureInstaller;
  scimSync?: ScimSyncWorkerFeatureInstaller;
  joinRequest?: JoinRequestWorkerFeatureInstaller;
}): readonly WorkerFeatureInstallerPort[] {
  const ordered: (WorkerFeatureInstallerPort | undefined)[] = [
    installers.automation,
    installers.eventingMaintenance,
    installers.langyMaintenance,
    installers.apiKey,
    installers.github,
    installers.evaluation,
    installers.codingAgent,
    installers.governanceEvents,
    installers.gatewaySpend,
    installers.metric,
    installers.log,
    installers.trace,
    installers.suite,
    installers.scenario,
    installers.experiment,
    installers.langyConversation,
    installers.topic,
    installers.governanceIngestion,
    installers.billingReporting,
    installers.authz,
    installers.identity,
    installers.ssoConnection,
    installers.scimSync,
    installers.joinRequest,
  ];
  return ordered.filter(
    (installer): installer is WorkerFeatureInstallerPort => installer !== undefined,
  );
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
 *
 * The sweeper is handed the queue's Redis rather than a connection of this
 * composition's own: the keys it walks are written by the queue when it
 * offloads a payload, so a sweeper pointed anywhere else reports a clean
 * empty sweep forever while the real keyspace grows. Reclaim destroys bytes,
 * which is why the connection has to be the same one that wrote them.
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
 * The one organization read the internal governance project mint makes.
 *
 * The oldest team is where an organization's internal project is created, and
 * `OrganizationService` answers it by exactly this query — a `findFirst`
 * ordered by creation. Composing the whole capability to reach it would name a
 * members graph, an invite flow and a billing profile this path never touches.
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
 * The SaaS cross-pipeline meter pair, composed from this process's own graph.
 *
 * Three substrates, and none of them is new to this composition: the tenant-
 * keyed ClickHouse client the event store already resolves through, the one
 * Prisma client this process opened, and the queue's one Redis.
 *
 * The ClickHouse client is asked for by ORGANIZATION here, which the tenant
 * resolver answers because the routing directory behind it treats an
 * organization id as a tenant of itself — the same lookup composed the other
 * way round, and the same physical endpoint. That equivalence is what removes
 * the recorded blocker: metering a private-instance customer needs their own
 * cluster, and this graph reaches it without opening a second connection pool
 * beside the one the process already holds. A directory that lost the
 * organization arm would route every private-instance organization to the
 * shared instance, so the pin below states it rather than leaving it inferred.
 *
 * Attribution rides the App's own Redis keyspace: both graphs answer "which
 * organization is this project billed to" from `ttlcache:org:resolve:`, and
 * the answer cannot go stale — a project belongs to a team and a team to an
 * organization, and neither link is reassignable.
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
      "worker composed the gateway spend pipeline without a settlement sweeper: it needs every configured ClickHouse instance and this process holds a tenant-keyed resolver, so a request whose confirmation never arrives stays admitted rather than being settled as cost-unknown",
    );
  }

  withoutSqsWebhookDestinations(): void {
    this.logger.warn(
      "worker composed webhook delivery without a queue transport: an endpoint that delivers to SQS is refused by name rather than retried, so its events never arrive",
    );
  }

  withoutWebhookEntitlements(): void {
    this.logger.warn(
      "worker composed webhook delivery without an entitlement graph: a delivery cannot read its organization's plan, so the batch is refused rather than delivered to an organization that may not have bought the feature",
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

/** Names Langy's three conversation absences once, at boot, rather than leaving them inferred. */
/**
 * Automation settlement's seven absences, said once at boot.
 *
 * They are one class rather than seven checks scattered through the graph
 * because they answer one question a reader has exactly once — what can this
 * process NOT do about a match it settles — and because a settlement half that
 * quietly did most of the job would look identical from outside to one that did
 * all of it.
 */
export class LoggedWorkerAutomationSettlementAbsence extends WorkerAutomationSettlementAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerAutomationSettlementAbsence {
    return new LoggedWorkerAutomationSettlementAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutLegacyFilterMatching(): void {
    this.logger.warn(
      "worker composed automation settlement without the legacy filter matcher: an automation still carrying the pre-query filters map is refused by name at confirmation, and one carrying a filter query confirms normally",
    );
  }

  withoutTraceRecordRead(): void {
    this.logger.warn(
      "worker composed automation settlement without the full trace read: a digest entry whose summary fold has not landed is refused rather than filled in from the trace record",
    );
  }

  withoutDatasetPersist(): void {
    this.logger.warn(
      "worker composed automation settlement without the dataset row mapping: an ADD_TO_DATASET automation is refused by name rather than writing rows whose columns disagree with the mapping the customer previewed",
    );
  }

  withoutAnnotationQueuePersist(): void {
    this.logger.warn(
      "worker composed automation settlement without an annotation queue writer: an ADD_TO_ANNOTATION_QUEUE automation is refused by name",
    );
  }

  withoutRunawayContainment(): void {
    this.logger.warn(
      "worker composed automation settlement without runaway containment: an automation past its daily ceiling still skips and still logs the breach, but nobody is notified and a misconfigured automation is not paused",
    );
  }

  withoutPlanResolvedPersistCap(): void {
    this.logger.warn(
      "worker composed automation settlement without an entitlement provider: the daily persist ceiling is the paid tier for every project rather than the one its plan grants",
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

export class LoggedWorkerLangyAbsence extends WorkerLangyAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerLangyAbsence {
    return new LoggedWorkerLangyAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutAgentManager(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without an agent manager: OPENCODE_AGENT_URL and LANGY_INTERNAL_SECRET are unset, so every dispatched turn is answered unavailable and fails rather than running",
    );
  }

  withoutTitleGeneration(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without model resolution: conversations keep the title they were given and none is generated from the transcript",
    );
  }

  withoutSessionKeyMint(): void {
    this.logger.warn(
      "worker composed the langy conversation pipeline without an authorization graph: a turn whose agent manager asks for credentials cannot be recovered and fails instead",
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
 * Reports the composition decision an absent directory capability would
 * otherwise hide.
 *
 * The connection pipeline mounts either way, so all sixteen of its routing
 * keys are claimed and a requested teardown completes on time.
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
      "worker composed the SSO connection ledger without a directory capability: a torn-down connection completes on time and its SCIM token rows are left in place, where they fail verification against the connection's torn-down state",
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

/**
 * Names the model gateway's absences once, at boot, rather than leaving them
 * inferred from a clustering schedule that never advances.
 *
 * The first is the one that matters to an operator: it says WHY no model can be
 * resolved, and the two reasons need different actions — one is a variable
 * nobody exported, the other is a capability this process does not compose yet.
 */
/** Names the one half of the tenancy graph this tier does not serve. */
export class LoggedWorkerTenancyAbsence extends WorkerTenancyAbsenceReportPort {
  static create(logger: Pick<Logger, "info">): LoggedWorkerTenancyAbsence {
    return new LoggedWorkerTenancyAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "info">) {
    super();
  }

  withoutGrantWrites(): void {
    this.logger.info(
      { reason: "consumer-only-ledger" },
      "worker composed the tenancy graph for reads: it folds grant events rather than producing them, so a grant change for an organization already on the ledger would refuse by name here",
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
 * No graph vertical, so Evaluation's graph-alert subscriber has nothing to
 * re-evaluate against.
 *
 * Reached only where `BASE_HOST` is unset, which is the same condition that
 * already refuses every outbound delivery: a graph alert that fired here could
 * not be sent anywhere. Listing no triggers is the honest answer — the sweep
 * finds nothing to evaluate — and the evaluation itself refuses by name rather
 * than reporting a result nobody asked it to compute.
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

/** Names Trace's two storage absences once, at boot, rather than leaving them inferred. */
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

  withoutDatasetStorage(): void {
    this.logger.warn(
      { reason: "azure-dataset-storage-unsupported" },
      "worker composed dataset normalization on an Azure-backed deployment: this process has no Azure blob driver for datasets, so a normalize job fails by name rather than writing chunks somewhere unreadable",
    );
  }
}

/**
 * The trigger-match recorder a non-consuming graph gets.
 *
 * It refuses rather than swallowing, because the only way to reach it is a
 * graph that started consuming without Automation — and a trigger match that
 * silently vanished is a customer's alert that never arrives with nothing to
 * show for it.
 */
class AbsentTraceTriggerMatches extends AutomationTriggerMatchRecorderPort {
  async send(): Promise<void> {
    throw new Error("Trace processing recorded a trigger match, but Automation is not composed.");
  }
}
