import type {
  EventingServerRuntimeOptions,
  ProcessRetentionMetricsPort,
} from "@langwatch/eventing/server";
import {
  EnterpriseWorkerComposition,
  type EnterpriseWorkerCompositionOptions,
} from "@langwatch/enterprise-worker";
import type { Logger } from "@langwatch/observability";
import type { ProcessObservability } from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  type AgentSandboxKeyReapDatabase,
  PostgresAgentSandboxKeyReapAdapter,
} from "@langwatch/api-key-server";
import {
  type GithubBranchMaintenanceDatabase,
  PostgresGithubBranchMaintenanceAdapter,
} from "@langwatch/github-server";
import {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
  PostgresScimSyncPipelineAdapter,
  type ScimSyncPipelineDatabase,
} from "@langwatch/identity-eventing";
import {
  type LangySessionKeyReapDatabase,
  OtelLangySessionKeyMetricsAdapter,
  PostgresLangySessionKeyReapAdapter,
} from "@langwatch/langy-server";
import {
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
  ClickHouseBillableEventsMeterAdapter,
  EventingBillableEventsMeterAdapter,
  EventingBillingMeterDispatchAdapter,
  PostgresBillingTenantOrganizationAdapter,
  RedisBillingTenantOrganizationCacheAdapter,
  BillingTenantOrganizationService,
  type BillingTenantOrganizationDatabase,
} from "@langwatch/enterprise-billing-server";
import { ClickHouseSuiteRunProcessingAdapter } from "@langwatch/suite-server";
import {
  TopicServerInstaller,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import {
  TraceCanonicalisationService,
  TraceProcessingInstallerPort,
} from "@langwatch/trace-server";
import { ApiKeyWorkerFeatureInstaller } from "../features/api-key/api-key-worker-feature.installer";
import {
  AuthzWorkerFeatureInstaller,
  type AuthzWorkerCapability,
} from "../features/authz/authz-worker-feature.installer";
import {
  AutomationWorkerFeatureInstaller,
  type AutomationWorkerCapability,
} from "../features/automation/automation-worker-feature.installer";
import {
  BillingReportingWorkerFeatureInstaller,
  type BillingReportingWorkerCapability,
} from "../features/billing/billing-reporting-worker-feature.installer";
import {
  CodingAgentWorkerFeatureInstaller,
  type CodingAgentWorkerCapability,
} from "../features/coding-agent/coding-agent-worker-feature.installer";
import {
  EvaluationWorkerFeatureInstaller,
  type EvaluationWorkerCapability,
} from "../features/evaluation/evaluation-worker-feature.installer";
import {
  EventingMaintenanceWorkerFeatureInstaller,
  type WorkerBlobSweepPort,
} from "../features/eventing-maintenance/eventing-maintenance-worker-feature.installer";
import {
  ExperimentWorkerFeatureInstaller,
  type ExperimentWorkerCapability,
} from "../features/experiment/experiment-worker-feature.installer";
import {
  GatewaySpendWorkerFeatureInstaller,
  type GatewaySpendWorkerCapability,
} from "../features/gateway/gateway-spend-worker-feature.installer";
import {
  LangyConversationWorkerFeatureInstaller,
  type LangyConversationWorkerCapability,
} from "../features/langy/langy-conversation-worker-feature.installer";
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
import {
  ScenarioWorkerFeatureInstaller,
  type ScenarioWorkerCapability,
} from "../features/scenario/scenario-worker-feature.installer";
import { SuiteWorkerFeatureInstaller } from "../features/suite/suite-worker-feature.installer";
import { IdentityWorkerFeatureInstaller } from "../features/identity/identity-worker-feature.installer";
import {
  JoinRequestWorkerFeatureInstaller,
  type JoinRequestWorkerCapability,
} from "../features/identity/join-request-worker-feature.installer";
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

/** The worker-owned runtime dependencies for the Topic feature. */
export type WorkerTopicCompositionOptions = {
  database: TopicServerInstallerDependencies["database"];
  redis: TopicServerInstallerDependencies["redis"];
  execution: TopicServerInstallerDependencies["execution"];
  metrics: TopicServerInstallerDependencies["metrics"];
};

/** Trace's package-owned processing registration, mounted before Topic. */
export type WorkerTraceCompositionOptions = {
  installer: TraceProcessingInstallerPort;
};

/** Automation's package-owned pipeline, mounted before every match producer. */
export type WorkerAutomationCompositionOptions = {
  installer: AutomationWorkerCapability;
};

/** The Eventing substrate's own blob and process-manager retention sweeps. */
export type WorkerEventingMaintenanceCompositionOptions = {
  blobSweep: WorkerBlobSweepPort;
  retentionMetrics: ProcessRetentionMetricsPort;
};

/** Langy's conversation pipeline, whose own effects append back into it. */
export type WorkerLangyConversationCompositionOptions = {
  installer: LangyConversationWorkerCapability;
};

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
  BillingTenantOrganizationDatabase &
  GithubBranchMaintenanceDatabase &
  IdentityPipelineDatabase &
  LangySessionKeyReapDatabase &
  ScimSyncPipelineDatabase;

/**
 * The two identity ledgers this graph still RECEIVES (ADR-101).
 *
 * The other two — `identity` and `scim-sync` — are composed below from
 * `@langwatch/identity-eventing`'s Postgres seams, because every dependency
 * they take is a Postgres binding. These two are not: the connection ledger's
 * teardown port revokes a torn-down connection's directory tokens through the
 * SCIM service, and the join ledger's lifecycle port sends the reminder and
 * the expiry notice. Neither the directory service nor an outbound mail
 * gateway exists as something this process can compose, so their definitions
 * still come from the application that has both.
 *
 * One option rather than two because they are one feature's ledger and the
 * app's writers resolve a sender by pipeline NAME on first use, so a graph
 * carrying one of them would stage commands for the other against a pipeline
 * nothing had registered. They have no ordering requirement among themselves —
 * none subscribes to another's events.
 *
 * Optional, like every group the legacy registry still owns. A graph without
 * it routes two of the four identity ledgers and must not claim
 * `event-sourcing/jobs`; that rule is the composition root's
 * (`createWorkerDurableComposition` asks for no consumers), and the parity
 * guard is what proves the packaged consumer routes all four.
 */
export type WorkerIdentityCompositionOptions = {
  ssoConnection: SsoConnectionWorkerCapability;
  joinRequest: JoinRequestWorkerCapability;
};

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

/**
 * Reports the composition decision an absent Coding Agent pipeline would
 * otherwise hide.
 *
 * Metric and Log mount either way: canonical points and records are stored by
 * their own projections and need nothing from another feature. What changes is
 * the ADR-056 edge — the two dispatch subscribers that lift a coding agent's
 * session-keyed facts out of those events and contribute them — because a
 * subscriber cannot dispatch into a pipeline this graph never registered. A
 * deployment should read that in its own logs at boot rather than infer it
 * from coding-agent sessions that stay empty.
 */
export abstract class WorkerCodingAgentFactsAbsenceReportPort {
  abstract withoutCodingAgentPipeline(): void;
}

/** Evaluation's durable processing pipeline, mounted before its dispatchers. */
export type WorkerEvaluationCompositionOptions = {
  installer: EvaluationWorkerCapability;
};

/** The ADR-056 Coding Agent session pipeline, mounted before its fact sources. */
export type WorkerCodingAgentCompositionOptions = {
  installer: CodingAgentWorkerCapability;
};

/**
 * The Governance events and Gateway spend pair.
 *
 * They are ONE option rather than two, because the live registry mounts both
 * under a single guard and neither is meaningful alone: the spend pipeline's
 * debit adapter delivers through Governance's commands, and Governance's
 * webhook delivery process has no producer without spend. Splitting them into
 * two optional fields would make "spend without governance" expressible, and
 * that graph silently drops every debit.
 */
export type WorkerGatewaySpendCompositionOptions = {
  governance: GovernanceEventsWorkerCapability;
  spend: GatewaySpendWorkerCapability;
};

/** The Scenario (simulation run) pipeline and its durable metrics retry. */
export type WorkerScenarioCompositionOptions = {
  installer: ScenarioWorkerCapability;
};

/** The Experiment run pipeline, whose metrics command Trace dispatches. */
export type WorkerExperimentCompositionOptions = {
  installer: ExperimentWorkerCapability;
};

/** Enterprise Governance's pulled-usage and ingestion-pull pipelines. */
export type WorkerGovernanceIngestionCompositionOptions = {
  installer: GovernanceIngestionWorkerCapability;
};

/** The monthly billing roll-up, whose command re-dispatches itself forward. */
export type WorkerBillingReportingCompositionOptions = {
  installer: BillingReportingWorkerCapability;
};

/** The AuthZ grants ledger, mounted last so every producer exists first. */
export type WorkerAuthzCompositionOptions = {
  installer: AuthzWorkerCapability;
};

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
  trace: WorkerTraceCompositionOptions;
  topic: WorkerTopicCompositionOptions;
  /** The process's Prisma client; taken from `topic` when a root omits it. */
  database?: WorkerDatabaseCompositionOptions;
  /**
   * Pipeline groups whose features have moved out of the legacy registry.
   * Each stays optional until every group in Wave 4 has landed: the shared
   * `event-sourcing/jobs` queue still belongs to the legacy worker, so an
   * incomplete graph must be composable without pretending to be complete.
   */
  automation?: WorkerAutomationCompositionOptions;
  eventingMaintenance?: WorkerEventingMaintenanceCompositionOptions;
  langyConversation?: WorkerLangyConversationCompositionOptions;
  evaluation?: WorkerEvaluationCompositionOptions;
  codingAgent?: WorkerCodingAgentCompositionOptions;
  gatewaySpend?: WorkerGatewaySpendCompositionOptions;
  scenario?: WorkerScenarioCompositionOptions;
  experiment?: WorkerExperimentCompositionOptions;
  governanceIngestion?: WorkerGovernanceIngestionCompositionOptions;
  billingReporting?: WorkerBillingReportingCompositionOptions;
  authz?: WorkerAuthzCompositionOptions;
  identity?: WorkerIdentityCompositionOptions;
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
    // Stripe, and visible nowhere else. Refuse at composition instead.
    if (options.config.deployment.saas && !options.billingReporting) {
      throw new Error(
        "A SaaS worker mounts the billable-events meter, whose usage reports are sent by the billing reporting pipeline; compose that pipeline or do not declare this process SaaS.",
      );
    }
    let billingReportingInstaller: BillingReportingWorkerFeatureInstaller | undefined;
    const saasMeter = options.config.deployment.saas
      ? saasBillableEventsMeter({
          database: options.database ?? options.topic.database,
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
    const automation = options.automation
      ? AutomationWorkerFeatureInstaller.create({
          installer: options.automation.installer,
          eventing,
        })
      : undefined;
    const eventingMaintenance = options.eventingMaintenance
      ? EventingMaintenanceWorkerFeatureInstaller.create({
          eventing,
          blobSweep: options.eventingMaintenance.blobSweep,
          retentionMetrics: options.eventingMaintenance.retentionMetrics,
        })
      : undefined;
    const langyConversation = options.langyConversation
      ? LangyConversationWorkerFeatureInstaller.create({
          installer: options.langyConversation.installer,
          eventing,
        })
      : undefined;
    // Unconditional, unlike the groups still owned by the legacy registry: the
    // sweep is composed from this package and the feature's own service, so
    // there is no graph in which it is present but unbuildable. The metrics
    // adapter is the feature's own because this process has no prom-client
    // registry to lend it; it writes the same series name the App writes.
    const langyMaintenance = LangyMaintenanceWorkerFeatureInstaller.create({
      eventing,
      sessionKeyReap: PostgresLangySessionKeyReapAdapter.create({
        database: options.database ?? options.topic.database,
        metrics: OtelLangySessionKeyMetricsAdapter.create(),
      }).build(),
    });
    // Unconditional, unlike the groups still owned by the legacy registry: the
    // sweep is composed from this package and the feature's own service, so
    // there is no graph in which it is present but unbuildable.
    const apiKey = ApiKeyWorkerFeatureInstaller.create({
      eventing,
      sandboxKeyReap: PostgresAgentSandboxKeyReapAdapter.create({
        database: options.database ?? options.topic.database,
      }).build(),
    });
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
        database: options.database ?? options.topic.database,
        config: {
          appId: githubConfig.appId ?? "",
          privateKey: githubConfig.privateKey ?? "",
        },
        redis: infrastructure?.redis ?? options.topic.redis,
        ...(githubConfig.host ? { hostConfig: { host: githubConfig.host } } : {}),
      }).build(),
    });
    const evaluation = options.evaluation
      ? EvaluationWorkerFeatureInstaller.create({
          installer: options.evaluation.installer,
          eventing,
        })
      : undefined;
    const codingAgent = options.codingAgent
      ? CodingAgentWorkerFeatureInstaller.create({
          installer: options.codingAgent.installer,
          eventing,
        })
      : undefined;
    const governanceEvents = options.gatewaySpend
      ? GovernanceEventsWorkerFeatureInstaller.create({
          installer: options.gatewaySpend.governance,
          eventing,
        })
      : undefined;
    const gatewaySpend = options.gatewaySpend
      ? GatewaySpendWorkerFeatureInstaller.create({
          installer: options.gatewaySpend.spend,
          eventing,
        })
      : undefined;
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
    if (!codingAgent) {
      WorkerProductionComposition.codingAgentFactsAbsence(options)?.withoutCodingAgentPipeline();
    }
    const metric = MetricWorkerFeatureInstaller.create({
      eventing,
      installer: ClickHouseMetricProcessingAdapter.create({
        resolveClient: options.eventing.resolveClickHouseClient,
        defaultRetentionDays: options.eventing.retention.defaultRetentionDays,
        metricCommandShardCount: resolveMetricCommandShardCount(
          options.config.processing.metricShards,
        ),
      }),
      ...(codingAgent
        ? {
            subscribers: [
              createCodingAgentMetricFactsDispatchSubscriber({
                contributeMetricFacts: codingAgent.commands.contributeMetricFacts,
              }),
            ],
          }
        : {}),
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
      ...(codingAgent
        ? {
            subscribers: [
              createCodingAgentLogFactsDispatchSubscriber({
                contributeLogFacts: codingAgent.commands.contributeLogFacts,
                // Stateless derivation of the generated session title out of
                // one response body; it reads nothing and holds nothing, so
                // this graph builds its own rather than taking the App's.
                traceCanonicalisation: TraceCanonicalisationService.create(),
              }),
            ],
          }
        : {}),
    });
    const trace = TraceWorkerFeatureInstaller.create({
      installer: options.trace.installer,
      eventing,
    });
    const topicServer = TopicServerInstaller.create({
      database: options.topic.database,
      processStore: eventing.processStore,
      redis: infrastructure?.redis ?? options.topic.redis,
      execution: options.topic.execution,
      metrics: options.topic.metrics,
    });
    const topic = TopicWorkerFeatureInstaller.create({
      installer: topicServer,
      eventing,
      traceAssignments: trace.traceAssignments,
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
    const scenario = options.scenario
      ? ScenarioWorkerFeatureInstaller.create({
          installer: options.scenario.installer,
          eventing,
        })
      : undefined;
    const experiment = options.experiment
      ? ExperimentWorkerFeatureInstaller.create({
          installer: options.experiment.installer,
          eventing,
        })
      : undefined;
    const governanceIngestion = options.governanceIngestion
      ? GovernanceIngestionWorkerFeatureInstaller.create({
          installer: options.governanceIngestion.installer,
          eventing,
        })
      : undefined;
    const billingReporting = options.billingReporting
      ? BillingReportingWorkerFeatureInstaller.create({
          installer: options.billingReporting.installer,
          eventing,
        })
      : undefined;
    billingReportingInstaller = billingReporting;
    const authz = options.authz
      ? AuthzWorkerFeatureInstaller.create({
          installer: options.authz.installer,
          eventing,
        })
      : undefined;
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
          database: options.database ?? options.topic.database,
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
          database: options.database ?? options.topic.database,
        }).build(),
      },
      eventing,
    });
    const ssoConnection = options.identity
      ? SsoConnectionWorkerFeatureInstaller.create({
          installer: options.identity.ssoConnection,
          eventing,
        })
      : undefined;
    const joinRequest = options.identity
      ? JoinRequestWorkerFeatureInstaller.create({
          installer: options.identity.joinRequest,
          eventing,
        })
      : undefined;
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

  /** The boot logger, as the one place a composition absence is declared. */
  private static githubAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerGithubAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerGithubAbsence.create(options.observability.logger)
      : undefined;
  }

  /** The same logger, for the ADR-056 edge Metric and Log mount without. */
  private static codingAgentFactsAbsence(
    options: WorkerProductionCompositionOptions,
  ): WorkerCodingAgentFactsAbsenceReportPort | undefined {
    return options.observability
      ? LoggedWorkerCodingAgentFactsAbsence.create(options.observability.logger)
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
      authz: options.authz,
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
  readonly authz: AuthzWorkerFeatureInstaller | undefined;

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
    authz: AuthzWorkerFeatureInstaller | undefined;
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
    this.authz = parts.authz;
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
 *   authz                the grants ledger opens its durable write path only
 *                        once every producer is registered
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

/** Names the missing Coding Agent pipeline once, at boot, rather than leaving it inferred. */
export class LoggedWorkerCodingAgentFactsAbsence extends WorkerCodingAgentFactsAbsenceReportPort {
  static create(logger: Pick<Logger, "warn">): LoggedWorkerCodingAgentFactsAbsence {
    return new LoggedWorkerCodingAgentFactsAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  withoutCodingAgentPipeline(): void {
    this.logger.warn(
      { reason: "no-coding-agent-pipeline" },
      "worker composed metric and log processing without the Coding Agent pipeline: canonical points and records are still stored, and no coding-agent session facts are contributed from them",
    );
  }
}
