import type {
  EventingServerRuntimeOptions,
  ProcessRetentionMetricsPort,
} from "@langwatch/eventing/server";
import {
  EnterpriseWorkerComposition,
  type EnterpriseWorkerCompositionOptions,
} from "@langwatch/enterprise-worker";
import type { ProcessObservability } from "@langwatch/observability/node";
import { ResourceScope } from "@langwatch/runtime-composition";
import {
  type AgentSandboxKeyReapDatabase,
  PostgresAgentSandboxKeyReapAdapter,
} from "@langwatch/api-key-server";
import {
  TopicServerInstaller,
  type TopicServerInstallerDependencies,
} from "@langwatch/topic-server";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
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
import {
  LangyMaintenanceWorkerFeatureInstaller,
  type LangyMaintenanceWorkerCapability,
} from "../features/langy/langy-maintenance-worker-feature.installer";
import {
  GithubWorkerFeatureInstaller,
  type GithubWorkerCapability,
} from "../features/github/github-worker-feature.installer";
import {
  GovernanceEventsWorkerFeatureInstaller,
  type GovernanceEventsWorkerCapability,
} from "../features/governance/governance-events-worker-feature.installer";
import {
  GovernanceIngestionWorkerFeatureInstaller,
  type GovernanceIngestionWorkerCapability,
} from "../features/governance/governance-ingestion-worker-feature.installer";
import {
  LogWorkerFeatureInstaller,
  type LogWorkerCapability,
  type LogWorkerSubscribers,
} from "../features/log/log-worker-feature.installer";
import {
  MetricWorkerFeatureInstaller,
  type MetricWorkerCapability,
  type MetricWorkerSubscribers,
} from "../features/metric/metric-worker-feature.installer";
import {
  ScenarioWorkerFeatureInstaller,
  type ScenarioWorkerCapability,
} from "../features/scenario/scenario-worker-feature.installer";
import {
  SuiteWorkerFeatureInstaller,
  type SuiteWorkerCapability,
} from "../features/suite/suite-worker-feature.installer";
import {
  IdentityWorkerFeatureInstaller,
  type IdentityWorkerCapability,
} from "../features/identity/identity-worker-feature.installer";
import {
  JoinRequestWorkerFeatureInstaller,
  type JoinRequestWorkerCapability,
} from "../features/identity/join-request-worker-feature.installer";
import {
  ScimSyncWorkerFeatureInstaller,
  type ScimSyncWorkerCapability,
} from "../features/identity/scim-sync-worker-feature.installer";
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

/** Langy's session-key reaper, on the same footing as the substrate sweeps. */
export type WorkerLangyMaintenanceCompositionOptions = {
  installer: LangyMaintenanceWorkerCapability;
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
export type WorkerDatabaseCompositionOptions = AgentSandboxKeyReapDatabase;

/**
 * The four identity pipelines (ADR-101), which mount as one group.
 *
 * One option rather than four because they are one feature's ledger: the app's
 * writers resolve a sender by pipeline NAME on first use, so a graph carrying
 * three of the four would stage commands for the fourth against a pipeline
 * nothing had registered. They have no ordering requirement among themselves —
 * none subscribes to another's events.
 */
export type WorkerIdentityCompositionOptions = {
  identity: IdentityWorkerCapability;
  ssoConnection: SsoConnectionWorkerCapability;
  scimSync: ScimSyncWorkerCapability;
  joinRequest: JoinRequestWorkerCapability;
};

/** GitHub pull-request linkage maintenance, fleet-wide rather than per replica. */
export type WorkerGithubCompositionOptions = {
  installer: GithubWorkerCapability;
};

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

/** The Suite run pipeline, mounted before the Scenario pipeline that reports into it. */
export type WorkerSuiteCompositionOptions = {
  installer: SuiteWorkerCapability;
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

/** Metric's package-owned processing pipeline and its dispatch subscribers. */
export type WorkerMetricCompositionOptions = {
  installer: MetricWorkerCapability;
  subscribers?: MetricWorkerSubscribers;
};

/** Log's package-owned processing pipeline and its dispatch subscribers. */
export type WorkerLogCompositionOptions = {
  installer: LogWorkerCapability;
  subscribers?: LogWorkerSubscribers;
};

/** The AuthZ grants ledger, mounted last so every producer exists first. */
export type WorkerAuthzCompositionOptions = {
  installer: AuthzWorkerCapability;
};

/**
 * Cross-pipeline projections the Eventing runtime takes at construction.
 *
 * A global projection is not an installer: its queues join the shared job
 * registry as soon as the first pipeline registers, so it has to be configured
 * before any feature mounts. The live registry uses this seam for the SaaS
 * billable-events meter and the reporting subscriber that follows it, whose
 * `global:*` routing keys share `event-sourcing/jobs` with every pipeline.
 */
export type WorkerGlobalProjectionsCompositionOptions = {
  configure: NonNullable<WorkerEventingProductionOptions["configureGlobalProjections"]>;
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
  langyMaintenance?: WorkerLangyMaintenanceCompositionOptions;
  github?: WorkerGithubCompositionOptions;
  evaluation?: WorkerEvaluationCompositionOptions;
  codingAgent?: WorkerCodingAgentCompositionOptions;
  gatewaySpend?: WorkerGatewaySpendCompositionOptions;
  metric?: WorkerMetricCompositionOptions;
  log?: WorkerLogCompositionOptions;
  suite?: WorkerSuiteCompositionOptions;
  scenario?: WorkerScenarioCompositionOptions;
  experiment?: WorkerExperimentCompositionOptions;
  governanceIngestion?: WorkerGovernanceIngestionCompositionOptions;
  billingReporting?: WorkerBillingReportingCompositionOptions;
  authz?: WorkerAuthzCompositionOptions;
  identity?: WorkerIdentityCompositionOptions;
  globalProjections?: WorkerGlobalProjectionsCompositionOptions;
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

    const eventing = WorkerEventingRuntime.createProduction({
      persistence: eventingOptions,
      warnWhenProjectionsRunInline: options.config.nodeEnvironment === "production",
      ...(options.globalProjections
        ? { configureGlobalProjections: options.globalProjections.configure }
        : {}),
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
    const langyMaintenance = options.langyMaintenance
      ? LangyMaintenanceWorkerFeatureInstaller.create({
          installer: options.langyMaintenance.installer,
          eventing,
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
    // there is no graph in which it is present but unbuildable.
    const apiKey = ApiKeyWorkerFeatureInstaller.create({
      eventing,
      sandboxKeyReap: PostgresAgentSandboxKeyReapAdapter.create({
        database: options.database ?? options.topic.database,
      }).build(),
    });
    const github = options.github
      ? GithubWorkerFeatureInstaller.create({
          installer: options.github.installer,
          eventing,
        })
      : undefined;
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
    const metric = options.metric
      ? MetricWorkerFeatureInstaller.create({
          installer: options.metric.installer,
          eventing,
          ...(options.metric.subscribers ? { subscribers: options.metric.subscribers } : {}),
        })
      : undefined;
    const log = options.log
      ? LogWorkerFeatureInstaller.create({
          installer: options.log.installer,
          eventing,
          ...(options.log.subscribers ? { subscribers: options.log.subscribers } : {}),
        })
      : undefined;
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
    const suite = options.suite
      ? SuiteWorkerFeatureInstaller.create({
          installer: options.suite.installer,
          eventing,
        })
      : undefined;
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
    const authz = options.authz
      ? AuthzWorkerFeatureInstaller.create({
          installer: options.authz.installer,
          eventing,
        })
      : undefined;
    const identity = options.identity
      ? IdentityWorkerFeatureInstaller.create({
          installer: options.identity.identity,
          eventing,
        })
      : undefined;
    const ssoConnection = options.identity
      ? SsoConnectionWorkerFeatureInstaller.create({
          installer: options.identity.ssoConnection,
          eventing,
        })
      : undefined;
    const scimSync = options.identity
      ? ScimSyncWorkerFeatureInstaller.create({
          installer: options.identity.scimSync,
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
 *   langy-maintenance    the session-key reaper, unconditional like the
 *                        substrate sweeps and mounted with them
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

/** Consumer ownership belongs to the Eventing runtime, not to its adapters. */
function withoutConsumers<Options extends WorkerEventingConsumerCompositionOptions>(
  options: Options,
): Omit<Options, "consumers"> {
  const { consumers: _consumers, ...persistence } = options;
  return persistence;
}
