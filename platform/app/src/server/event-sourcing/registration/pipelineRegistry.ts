import {
  AppGovernanceEventingAdapter,
  type AppGovernanceEventingRuntime,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import {
  AppGatewayDebitAdapter,
  GovernanceSignalDeliveryPort,
  type GatewayGovernancePort,
} from "@langwatch/enterprise-api";
import {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  createGovernanceEventsPipeline,
  type GovernanceBudgetCrossingData,
  type GovernanceTraceEvent,
  type GovernanceTraceSummary,
  type GovernanceVkLifecycleData,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerPort,
} from "@langwatch/enterprise-governance-server";
import {
  AppGovernanceSubscriberAdapter,
  type AppGovernanceKpisSubscriberDependencies,
  type AppGovernanceOcsfSubscriberDependencies,
  GovernanceSubscriberRuntime,
  type TraceAlertTriggerMatchInput,
} from "@langwatch/enterprise-api/governance/governance-subscriber.adapter";
import type { WebhookDeliveryProcessDeps } from "~/runtime/app/features/webhooks";
import { AppGovernanceWebhookAdapter } from "@langwatch/enterprise-api/governance/governance-webhook.adapter";
import type {
  AppendStore,
  EventSourcing,
  EventSourcedQueueProcessor,
  FoldProjectionStore,
  Projection,
  ProjectionStore,
  ProcessStore,
  StateProjectionStore,
  StaticPipelineDefinition,
  TriggerContext,
} from "@langwatch/eventing";
import {
  type CommandDispatcher,
  createTenantId,
  Deferred,
  mapCommands,
  RedisCachedFoldStore,
  RepositoryFoldStore,
  throttledWindow,
} from "@langwatch/eventing";
import type {
  TraceCanonicalisationService,
  TraceService,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { GithubService } from "@langwatch/github-contract";
import { BlobSweeper } from "@langwatch/group-queue/operational";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import type { PrismaClient } from "~/generated/prisma/client";
import { NOTIFY_TRIGGER_ACTIONS } from "@langwatch/automation-contract";
import { passesTraceOriginGuards } from "~/server/event-sourcing/pipelines/trace-processing/subscribers/_originGuardedSubscriber";
import { recordTrackedEventSpan } from "~/server/app-layer/events/track-event.service";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import type { DatasetNormalizePayload } from "@langwatch/dataset-server";
import { classifyTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import type { GatewaySpendEventsPort } from "@langwatch/gateway-server";
import { incrementAutomationMatchRecordsTotal } from "~/server/metrics";
import {
  incrementTopicClusteringPageTotal,
  observeTopicClusteringPageDuration,
} from "~/server/metrics";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import type { UsageReportingService } from "~/runtime/app/features/billing";
import { AppTraceRecordSpanAdapter } from "~/runtime/app/trace-record-span.adapter";
import type { AppTraceProjectionStorage } from "~/runtime/app/trace-projection-storage.adapter";
import type {
  AutomationEvaluationSubscriberService,
  AutomationService,
} from "@langwatch/automation-contract";
import type {
  EvaluationService,
  ExecuteEvaluationCommandData,
  ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type { SuiteRunStateData } from "@langwatch/suite-contract";
import type { BillingCheckpointService } from "../../app-layer/billing/billingCheckpoint.service";
import type { BroadcastService } from "../../app-layer/broadcast/broadcast.service";
import type { CodingAgentProjectionPersistence } from "@langwatch/coding-agent-contract";
import {
  EventingCodingAgentProcessingAdapter,
  PrometheusCodingAgentCostMetricsAdapter,
  SystemCodingAgentClock,
  createCodingAgentLogFactsDispatchSubscriber,
  createCodingAgentMetricFactsDispatchSubscriber,
  createCodingAgentSpanFactsDispatchSubscriber,
} from "@langwatch/coding-agent-server";
import type { EvaluationCostRecorderPort } from "@langwatch/evaluation-server";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { LangyTitleGenerator } from "~/runtime/app/features/langy-title-generation.adapter";
import type { LangySessionKeyService, LangyWorkerPort } from "@langwatch/langy-server";
import type { LangyTurnAdmissionCapability } from "@langwatch/langy-contract";
import type { LangyTokenBuffer } from "@langwatch/langy-server";
import type { LangyTurnHandoffStore } from "@langwatch/langy-server";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
} from "@langwatch/langy-server";
import type { LogRuntimeAdapter } from "@langwatch/log-server";
import type { MetricRuntimeAdapter } from "@langwatch/metric-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import type { OrganizationService } from "../../app-layer/organizations/organization.service";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  TraceAnalyticsRepository,
  TraceAnalyticsRollupRepository,
  TraceSummaryRepository,
} from "@langwatch/trace-server";
import type { SpanStorageService } from "../../app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "../../app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryService } from "../../app-layer/traces/trace-summary.service";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import {
  createAutomationsPipeline,
  createGraphTriggerActivityHandler,
} from "@langwatch/automation-server";
import type { AutomationDispatchPorts } from "~/runtime/app/features/automation-dispatch.wiring";
import { ReportUsageForMonthCommand } from "../pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "../pipelines/billing-reporting/pipeline";
import { createBlobMaintenancePipeline } from "../pipelines/blob-maintenance/pipeline";
import {
  EvaluationExecutionIntentService,
  ExecuteEvaluationCommand,
  EvaluationEventingAdapter,
  type EvaluationInputOffloadConfig,
  createEvaluationProcessingPipeline,
} from "@langwatch/evaluation-server";
import {
  AppEvaluationAzureSafetyCredentialsPort,
  type AppEvaluationExecutionControls,
} from "~/runtime/app/features/evaluation";
import { AppAutomationEvaluationSubscriberRuntime } from "~/runtime/app/features/evaluation-automation-subscribers.adapter";
import { AppEvaluationExecutionReceiptPort } from "~/runtime/app/features/evaluation-execution-receipt.adapter";
import { TraceAnalyticsAttributePolicy } from "~/runtime/app/features/evaluation-analytics-attribute-policy.adapter";
import {
  createExperimentRunProcessingPipeline,
  createExperimentRunStateFoldStore,
  type ClickHouseExperimentRunResultRecord,
  type ComputeExperimentRunMetricsCommandData,
  type ExperimentIdLookup,
  type ExperimentRunStateData,
  type ExperimentRunStateRepository,
} from "@langwatch/experiment-server";
import { createGatewaySpendProcessingPipeline } from "../pipelines/gateway-spend-processing/pipeline";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../pipelines/gateway-spend-processing/process-manager/spendSettlement.process";
import type { GatewaySpendState } from "@langwatch/gateway-server";
import { GatewaySpendStore } from "../pipelines/gateway-spend-processing/projections/gatewaySpend.store";
import type { OpenAdmission } from "../pipelines/gateway-spend-processing/repositories/openAdmissions.clickhouse.repository";
import { getOpenAdmissionFindersByInstance } from "../pipelines/gateway-spend-processing/repositories/openAdmissions.clickhouse.repository";
import { GATEWAY_SPEND_PIPELINE_NAME } from "@langwatch/gateway-server";
import { EventingGithubMaintenanceAdapter } from "@langwatch/github-server";
import { createLangyConversationProcessingPipeline } from "@langwatch/langy-server";
import { createLangyEffectPorts } from "../pipelines/langy-conversation-processing/process-manager/langyEffectPorts";
import type { LangyAnalyticsEventProjectionRecord } from "@langwatch/langy-server";
import { createLangyMaintenancePipeline } from "../pipelines/langy-maintenance/pipeline";
import { type EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingEvent } from "@langwatch/log-contract";
import type { MetricProcessingEvent } from "@langwatch/metric-contract";
import { createProcessManagerMaintenancePipeline } from "../pipelines/process-manager-maintenance/pipeline";
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
  SimulationProcessingPipelineAdapter,
  FinishRunCommand,
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  SimulationRunMetricsStoreAdapter,
  SimulationRunStateStoreAdapter,
  simulationRunExecutionPM,
} from "@langwatch/scenario-server";
import {
  type ComputeRunMetricsCommandData,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";
import {
  createSuiteRunProcessingPipeline,
  SUITE_RUN_PROJECTION_VERSIONS,
} from "@langwatch/suite-server";
import {
  classifyClusteringError,
  createTopicClusteringProcessingPipeline,
  RedisTopicClusteringBootstrapAdapter,
  type TopicClusteringOutcomeCommands,
  type TopicClusteringRunHistoryData,
  type TopicClusteringRunPort,
  type TopicClusteringRunStatusData,
  type TopicModelData,
} from "@langwatch/topic-server";
import { resolveSpanCommandShardCount } from "@langwatch/trace-server";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "~/runtime/app/trace-processing.adapter";
import { AppTraceProjectionStorageAdapter } from "~/runtime/app/trace-projection-storage.adapter";
import { SpanStorageStore } from "@langwatch/trace-server";
import type { TraceAnalyticsData } from "@langwatch/trace-server";
import { TraceAnalyticsStore } from "@langwatch/trace-server";
import { TraceAnalyticsRollupStore } from "@langwatch/trace-server";
import type { ResolveOriginCommandData } from "@langwatch/trace-contract";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";
import { AppCodingAgentTraceProcessingAdapter } from "~/runtime/app/features/coding-agent-trace-processing.adapter";
import { createCustomEvaluationSyncHandler } from "../pipelines/trace-processing/subscribers/customEvaluationSync.subscriber";
import { createEvaluationTriggerSubscriber } from "~/runtime/app/trace-evaluation-trigger.adapter";
import { createExperimentMetricsSyncHandler } from "../pipelines/trace-processing/subscribers/experimentMetricsSync.subscriber";
import {
  createDeferredOriginHandler,
  createOriginGateHandler,
  DEFERRED_CHECK_DELAY_MS,
  type DeferredOriginPayload,
  makeDeferredJobId,
} from "../pipelines/trace-processing/subscribers/originGate.subscriber";
import { createProjectMetadataHandler } from "../pipelines/trace-processing/subscribers/projectMetadata.subscriber";
import { createSimulationMetricsSyncHandler } from "../pipelines/trace-processing/subscribers/simulationMetricsSync.subscriber";
import { createSpanStorageBroadcastHandler } from "../pipelines/trace-processing/subscribers/spanStorageBroadcast.subscriber";
import { createTraceUpdateBroadcastHandler } from "../pipelines/trace-processing/subscribers/traceUpdateBroadcast.subscriber";
import { createTrackedEventSyncHandler } from "../pipelines/trace-processing/subscribers/trackedEventSync.subscriber";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

type EvaluationPipelineCommands = {
  executeEvaluation: CommandDispatcher<ExecuteEvaluationCommandData>;
  reportEvaluation: CommandDispatcher<ReportEvaluationCommandData>;
};

class AppGovernanceSubscriberRuntime extends GovernanceSubscriberRuntime {
  capture(error: unknown): void {
    captureException(toError(error));
  }

  passesTraceOriginGuard(input: {
    event: GovernanceTraceEvent;
    state: GovernanceTraceSummary;
  }): boolean {
    return passesTraceOriginGuards(input.event, input.state);
  }

  countAutomationMatchRecords(count: number): void {
    incrementAutomationMatchRecordsTotal(count);
  }
}

class AppPipelineGovernanceSignalDeliveryPort extends GovernanceSignalDeliveryPort {
  private constructor(
    private readonly commands: {
      recordVkLifecycle: { send(data: GovernanceVkLifecycleData): Promise<unknown> };
      recordBudgetCrossing: {
        send(data: GovernanceBudgetCrossingData): Promise<unknown>;
      };
    },
  ) {
    super();
  }

  static create(commands: {
    recordVkLifecycle: { send(data: GovernanceVkLifecycleData): Promise<unknown> };
    recordBudgetCrossing: {
      send(data: GovernanceBudgetCrossingData): Promise<unknown>;
    };
  }): AppPipelineGovernanceSignalDeliveryPort {
    return new AppPipelineGovernanceSignalDeliveryPort(commands);
  }

  available(): boolean {
    return true;
  }

  async appendVirtualKeyLifecycle(data: GovernanceVkLifecycleData): Promise<void> {
    await this.commands.recordVkLifecycle.send(data);
  }

  async appendBudgetCrossing(data: GovernanceBudgetCrossingData): Promise<void> {
    await this.commands.recordBudgetCrossing.send(data);
  }
}

/**
 * Creates an in-memory setTimeout-based fallback for deferred job processing.
 * Used when the event-sourcing queue is unavailable (e.g. no Redis).
 */
function createInMemoryDeferredFallback<P>({
  makeId,
  delayMs,
  process,
  logContext,
  errorMessage,
}: {
  makeId?: (payload: P) => string;
  delayMs: number;
  process: (payload: P) => Promise<void>;
  logContext: (payload: P) => Record<string, unknown>;
  errorMessage: string;
}): (payload: P) => Promise<void> {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  return async (payload: P) => {
    if (makeId) {
      const dedupKey = makeId(payload);
      if (pending.has(dedupKey)) return;
      const timer = setTimeout(async () => {
        pending.delete(dedupKey);
        try {
          await process(payload);
        } catch (error) {
          logger.error({ ...logContext(payload), error }, errorMessage);
        }
      }, delayMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      pending.set(dedupKey, timer);
    } else {
      const timer = setTimeout(async () => {
        try {
          await process(payload);
        } catch (error) {
          logger.error({ ...logContext(payload), error }, errorMessage);
        }
      }, delayMs);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    }
  };
}

/**
 * Pre-constructed repositories, resolved at the composition root (presets.ts).
 * The registry consumes these directly — no ClickHouse client resolution here.
 */
export interface PipelineRepositories {
  /** Primary replica for read-after-write consistency. */
  simulationRunState: SimulationRunStateStoreAdapter;
  /** Write side of the simulationRunMetrics map projection (migration 00078). */
  simulationRunMetricsStore: SimulationRunMetricsStoreAdapter;
  /** Primary replica for read-after-write consistency. */
  experimentRunState: ExperimentRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  traceSummaryFold: TraceSummaryRepository;
  /** Coding Agent owns the four persistence models behind this named projection adapter. */
  codingAgentProjections: CodingAgentProjectionPersistence;
  /** ADR-034 Phase 1: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-034 Phase 2: slim per-trace analytics repository (dual-tap). */
  traceAnalytics: TraceAnalyticsRepository;
  experimentRunItemStorage: AppendStore<ClickHouseExperimentRunResultRecord>;
  /** experimentMetricsSync's late-bound runId -> experimentId lookup. */
  experimentIdLookup: ExperimentIdLookup;
  /** Direct Postgres operational projection; deliberately bypasses Redis. */
  langyConversationState: StateProjectionStore<LangyConversationStateData>;
  /** Direct Postgres per-turn operational projection. */
  langyConversationTurnState: StateProjectionStore<LangyConversationTurnData>;
  /** Postgres per-message operational projection. */
  langyMessageStorage: AppendStore<LangyMessageProjectionRecord>;
  /** Content-free ClickHouse event-grain analytics. */
  langyAnalyticsEventStorage: AppendStore<LangyAnalyticsEventProjectionRecord>;
  /**
   * Durable process inbox, state, and outbox persistence — SHARED across
   * every process manager (the ProcessManager* tables are generic; each
   * domain's dispatcher scopes its leases via `processNames`).
   */
  processStore: ProcessStore;
  /** Per-project topic clustering run status (ADR-051, Postgres). */
  topicClusteringRunStatus: StateProjectionStore<TopicClusteringRunStatusData>;
  /** Per-project topic clustering run history (audit; bounded). */
  topicClusteringRunHistory: StateProjectionStore<TopicClusteringRunHistoryData>;
  /** Write-through topic model store (the Topic table + cursor row). */
  topicModel: StateProjectionStore<TopicModelData>;
  /** Postgres-authoritative logical-send receipts and active-turn claims. */
  langyTurnAdmission: LangyTurnAdmissionCapability;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  traceCanonicalisation: TraceCanonicalisationService;
  logProcessing: LogRuntimeAdapter;
  metricProcessing: MetricRuntimeAdapter;
  /** Package-owned AuthZ definition; this registry only installs and binds it. */
  authz: {
    pipeline: StaticPipelineDefinition<any, any, any>;
    connect(commands: unknown): void;
  };
  repositories: PipelineRepositories;
  /** One write-through fold store shared by projection writes and immediate readers. */
  traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
  /** The Suite package's single run-state store, shared by Eventing and reads. */
  suiteRunState: ProjectionStore<Projection<SuiteRunStateData>>;
  redis: Redis | Cluster;
  broadcast: BroadcastService;
  simulations: SimulationService;
  scenarioExecutions: ScenarioExecutionService;
  langy: {
    buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
    handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
    worker: LangyWorkerPort;
    titleGenerator: LangyTitleGenerator;
    sessionKeys: LangySessionKeyService;
  };
  topicClustering: {
    /** Runs one clustering page (the ADR-051 effect's domain function). */
    runPort: TopicClusteringRunPort;
  };
  enterprisePipelines: AppGovernanceEventingRuntime;
  projects: ProjectService;
  monitors: MonitorService;
  modelProviders: ModelProviderService;
  featureFlags: FeatureFlagService;
  evaluationControls: AppEvaluationExecutionControls;
  automation: AutomationService;
  automations: { ports: AutomationDispatchPorts };
  prisma: PrismaClient;
  datasetNormalization: {
    process(payload: DatasetNormalizePayload): Promise<void>;
    connect(sender: (payload: DatasetNormalizePayload) => Promise<void>): void;
  };
  traces: {
    summary: TraceSummaryService;
    spans: SpanStorageService;
    tree: TraceService;
  };
  traceProjectionStorage: AppTraceProjectionStorage;
  evaluations: EvaluationService;
  analytics: AnalyticsService;
  storedObjects: StoredObjectsService;
  evaluationInputsOffloadConfig: EvaluationInputOffloadConfig;
  organizations: OrganizationService;
  costRecorder: EvaluationCostRecorderPort;
  billingCheckpoints: BillingCheckpointService;
  usageReportingService?: UsageReportingService;
  gatewaySpend?: { port: GatewaySpendEventsPort };
  webhookDelivery?: WebhookDeliveryProcessDeps;
  gatewayDebits?: GatewayGovernancePort;
  /**
   * ADR-022: BlobStore for RecordSpanCommand spool reconstitution.
   * When provided, the trace-processing pipeline wires it into RecordSpanCommand
   * so oversized commands (> 256 KB) are fetched from S3 and the spool is
   * best-effort DELETEd after event_log INSERT succeeds.
   */
  blobStore?: BlobStore;
  governanceKpisSync?: AppGovernanceKpisSubscriberDependencies;
  governanceOcsfEventsSync?: AppGovernanceOcsfSubscriberDependencies;
  retentionPolicyResolver?: DataRetentionService;
  codingAgent?: {
    github: GithubService;
  };
  /**
   * The fleet-wide GitHub linkage maintenance the scheduled process manager
   * drives. Late-bound for the same reason `codingAgent` is: the mapping
   * service and its repository are composed after the registry, so presets
   * passes `Deferred` callable proxies. Omitted where there is no GitHub
   * connection, in which case the pipeline is not registered at all.
   */
  github?: GithubService;
}

/** The one Automation-backed trigger catalogue used by Governance trace alerts. */
class AppGovernanceTraceAlertTriggerPort extends TraceAlertTriggerPort {
  private constructor(private readonly automation: AutomationService) {
    super();
  }

  static create(automation: AutomationService): AppGovernanceTraceAlertTriggerPort {
    return new AppGovernanceTraceAlertTriggerPort(automation);
  }

  async activeForProject(projectId: string) {
    const triggers = await this.automation.getActiveTraceTriggersForProject(projectId);
    return triggers.map((trigger) => ({
      id: trigger.id,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action) ? "notify" : "persist",
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
      hasEvaluationFilters: classifyTriggerFilters(trigger.filters).hasEvaluationFilters,
    }));
  }
}

/** The one durable command boundary for Governance trace-alert matches. */
class AppGovernanceTraceAlertMatchPort extends TraceAlertTriggerMatchPort {
  private constructor(
    private readonly recordTriggerMatch: EventSourcedQueueProcessor<TraceAlertTriggerMatchInput>,
  ) {
    super();
  }

  static create(
    recordTriggerMatch: EventSourcedQueueProcessor<TraceAlertTriggerMatchInput>,
  ): AppGovernanceTraceAlertMatchPort {
    return new AppGovernanceTraceAlertMatchPort(recordTriggerMatch);
  }

  async send(input: TraceAlertTriggerMatchInput): Promise<void> {
    await this.recordTriggerMatch.send(input);
  }
}

/**
 * Composition root for all event-sourcing pipelines.
 *
 * Creates store adapters, builds subscribers and command classes, then registers
 * all pipelines with the EventSourcing runtime. Pipelines receive only
 * store interfaces and pre-built artifacts — never raw deps like prisma or ClickHouse clients.
 */
export class PipelineRegistry {
  private governanceLifecycle:
    | ReturnType<AppGovernanceEventingAdapter["register"]>["lifecycle"]
    | undefined;
  constructor(private readonly deps: PipelineRegistryDeps) {}

  /**
   * ADR-051: the trace pipeline's projectMetadata subscriber bootstraps a
   * project's clustering schedule on its first real trace, but the topic
   * clustering pipeline (whose command it dispatches) registers later —
   * late-bound like the other cross-pipeline dispatchers.
   */
  private readonly bootstrapTopicClustering = new Deferred<(projectId: string) => Promise<void>>(
    "bootstrapTopicClustering",
  );

  private cached<State>(
    inner: FoldProjectionStore<State>,
    keyPrefix: string,
  ): FoldProjectionStore<State> {
    return new RedisCachedFoldStore<State>(inner, this.deps.redis as Redis, {
      keyPrefix,
    });
  }

  registerAll() {
    const traceSummaryStore = this.deps.traceSummaryStore;

    const automationPorts = this.deps.automations.ports;
    const graphActivityHandler = createGraphTriggerActivityHandler(this.deps.automation);
    const automationPipeline = this.deps.eventSourcing.register(
      createAutomationsPipeline({
        scheduledIntents: this.deps.automation,
        settlement: automationPorts.settlement,
        retention: this.deps.repositories.processStore,
      }),
    );
    // Queue-infrastructure maintenance. Registered unconditionally: the runtime
    // only arms the schedule where `roleRunsWorkers` holds, so on web this is
    // inert shape rather than a second fleet sweeping the same keyspace.
    const blobSweeper = new BlobSweeper({ redis: this.deps.redis });
    this.deps.eventSourcing.register(
      createBlobMaintenancePipeline({
        cleanup: {
          sweep: () => blobSweeper.sweep(),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    // Retention for the process-manager substrate's own tables. Registered
    // unconditionally and independently of any domain: it reaps by predicate
    // across every processName, so no process manager has to opt in and none
    // added later can be forgotten.
    this.deps.eventSourcing.register(
      createProcessManagerMaintenancePipeline({
        retentionSweep: {
          deleteDispatchedOutboxBatch: (params) =>
            this.deps.repositories.processStore.deleteDispatchedOutboxBatch(params),
          deleteDeadOutboxBatch: (params) =>
            this.deps.repositories.processStore.deleteDeadOutboxBatch(params),
          deleteConsumedInboxBatch: (params) =>
            this.deps.repositories.processStore.deleteConsumedInboxBatch(params),
        },
      }),
    );

    // Langy credential maintenance, on the same footing. The reaper existed and
    // was routed for cron, but the chart ships no CronJobs — so until now the
    // backstop for keys orphaned by a SIGKILLed manager had no caller at all.
    this.deps.eventSourcing.register(
      createLangyMaintenancePipeline({
        sessionKeyReap: {
          reap: () => this.deps.langy.sessionKeys.reapExpired(),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    // Pull-request linkage maintenance, on the same footing. It used to be a
    // `setTimeout` chain on every replica with no lock, so the fleet ran the
    // same cross-tenant scan N times every ten minutes.
    if (this.deps.github) {
      this.deps.eventSourcing.register(
        EventingGithubMaintenanceAdapter.create({
          github: this.deps.github,
          processStore: this.deps.repositories.processStore,
        }).build(),
      );
    }

    const automationCommands = mapCommands(automationPipeline.commands);
    const governanceTraceAlertTriggers = AppGovernanceTraceAlertTriggerPort.create(
      this.deps.automation,
    );
    const governanceTraceAlertMatches = AppGovernanceTraceAlertMatchPort.create(
      automationPipeline.commands.recordTriggerMatch,
    );
    const evaluationAutomationSubscribers = AppAutomationEvaluationSubscriberRuntime.create({
      automation: this.deps.automation,
      traces: this.deps.traces.tree,
      recordTriggerMatch: automationPipeline.commands.recordTriggerMatch,
    });
    const evalPipeline = this.registerEvaluationPipeline({
      automations: evaluationAutomationSubscribers,
    });
    const evaluationCommands: EvaluationPipelineCommands = mapCommands(evalPipeline.commands);
    // Registered BEFORE the metric, log and trace pipelines: their
    // coding-agent dispatch subscribers close over this pipeline's
    // contribution commands.
    const codingAgentCostMetrics = PrometheusCodingAgentCostMetricsAdapter.create();
    const codingAgentTraces = AppCodingAgentTraceProcessingAdapter.create({
      traceCanonicalisation: this.deps.traceCanonicalisation,
      spans: this.deps.traces.spans,
    });
    const codingAgentPipeline = this.registerCodingAgentPipeline(codingAgentCostMetrics);
    if (this.deps.gatewaySpend) {
      const governanceEvents = this.registerGovernanceEventsPipeline();
      const governanceDelivery = AppPipelineGovernanceSignalDeliveryPort.create(
        governanceEvents.commands,
      );
      this.registerGatewaySpendPipeline(this.deps.gatewaySpend, governanceDelivery);
    }
    const codingAgentCommands = mapCommands(codingAgentPipeline.commands);
    const metricPipeline = this.registerMetricPipeline({
      subscribers: [
        createCodingAgentMetricFactsDispatchSubscriber({
          contributeMetricFacts: codingAgentCommands.contributeMetricFacts,
        }),
      ],
    });
    const logPipeline = this.registerLogPipeline({
      subscribers: [
        createCodingAgentLogFactsDispatchSubscriber({
          contributeLogFacts: codingAgentCommands.contributeLogFacts,
          traceCanonicalisation: this.deps.traceCanonicalisation,
        }),
      ],
    });
    const {
      pipeline: tracePipeline,
      simComputeRunMetrics,
      wireExperimentDeps,
    } = this.registerTracePipeline({
      evaluationCommands,
      traceSummaryStore,
      automations: {
        triggerMatchHandler: AppGovernanceSubscriberAdapter.create(
          this.governanceSubscriberRuntime,
        ).traceAlerts(governanceTraceAlertTriggers, governanceTraceAlertMatches),
        graphActivityHandler,
      },
      codingAgentSubscribers: [
        createCodingAgentSpanFactsDispatchSubscriber({
          contributeSpanFacts: codingAgentCommands.contributeSpanFacts,
          traces: codingAgentTraces,
        }),
      ],
    });
    const suiteRunPipeline = this.registerSuiteRunPipeline();
    const simulationPipeline = this.registerSimulationPipeline({
      suiteRunPipeline,
      traceSummaryStore,
      simComputeRunMetrics,
    });

    const experimentRunPipeline = this.registerExperimentRunPipeline({
      wireExperimentDeps,
    });
    const { pipeline: langyConversationPipeline } = this.registerLangyConversationPipeline();
    const { pipeline: topicClusteringPipeline } = this.registerTopicClusteringPipeline();
    const enterprisePipelines = AppGovernanceEventingAdapter.create(
      this.deps.eventSourcing,
      this.deps.enterprisePipelines,
    ).register();
    this.governanceLifecycle = enterprisePipelines.lifecycle;
    const billingPipeline = this.registerBillingReportingPipeline();
    // The grants ledger (ADR-092 §13). The write paths emit through the
    // app-layer ledger module, gated PER ORGANIZATION (decision 4): only an
    // organization whose genesis import has landed (its
    // SystemMigrationTenantState row, read by the engine gate) sends
    // these commands; every other organization still takes the imperative
    // Prisma path, and an operator's `rolled_back` flip returns one there
    // with no deploy.
    const authzPipeline = this.deps.eventSourcing.register(this.deps.authz.pipeline);
    this.deps.authz.connect(authzPipeline.commands);

    logger.info("All pipelines registered");

    return {
      traces: mapCommands(tracePipeline.commands),
      metrics: mapCommands(metricPipeline.commands),
      logs: mapCommands(logPipeline.commands),
      codingAgents: mapCommands(codingAgentPipeline.commands),
      evaluations: mapCommands(evalPipeline.commands),
      experimentRuns: mapCommands(experimentRunPipeline.commands),
      simulations: mapCommands(simulationPipeline.commands),
      suiteRuns: mapCommands(suiteRunPipeline.commands),
      langy: mapCommands(langyConversationPipeline.commands),
      topicClustering: mapCommands(topicClusteringPipeline.commands),
      ingestionPull: enterprisePipelines.ingestionPull,
      pulledUsage: enterprisePipelines.pulledUsage,
      billing: mapCommands(billingPipeline.commands),
      automations: automationCommands,
    };
  }

  getGovernanceLifecycle(): NonNullable<PipelineRegistry["governanceLifecycle"]> {
    if (!this.governanceLifecycle) {
      throw new Error("Governance pipelines have not been registered");
    }
    return this.governanceLifecycle;
  }

  private readonly governanceSubscriberRuntime = new AppGovernanceSubscriberRuntime();

  /**
   * ADR-051: topic clustering scheduling as a builder-mounted process
   * manager (ADR-052) — the pipeline declares the whole topology (events,
   * projection, commands, process manager, outbox tuning); the shared
   * ProcessRuntime owns the manager, outbox and wake workers. The registry
   * only injects executor dependencies and late-binds the outcome commands,
   * which are this same pipeline's own write surface and exist only after
   * `.build()`.
   */
  private registerTopicClusteringPipeline() {
    let outcomeCommands: TopicClusteringOutcomeCommands | null = null;

    const pipeline = this.deps.eventSourcing.register(
      createTopicClusteringProcessingPipeline({
        topicClusteringRunStatusStore: this.deps.repositories.topicClusteringRunStatus,
        topicClusteringRunHistoryStore: this.deps.repositories.topicClusteringRunHistory,
        topicModelStore: this.deps.repositories.topicModel,
        dispatch: {
          runPort: this.deps.topicClustering.runPort,
          commands: () => {
            if (!outcomeCommands) {
              throw new Error(
                "Topic clustering outcome commands used before the pipeline finished registering",
              );
            }
            return outcomeCommands;
          },
          // The failure taxonomy lives with the clustering execution; the
          // intent executor only consumes its verdict.
          classifyError: classifyClusteringError,
          metrics: {
            incrementPageTotal: incrementTopicClusteringPageTotal,
            observePageDuration: observeTopicClusteringPageDuration,
          },
        },
      }),
    );

    const commands = mapCommands(pipeline.commands);
    outcomeCommands = {
      recordClusteringRunStarted: (args) => commands.recordClusteringRunStarted(args),
      recordClusteringRunCompleted: (args) => commands.recordClusteringRunCompleted(args),
      recordClusteringRunFailed: (args) => commands.recordClusteringRunFailed(args),
    };
    // Level-triggered bootstrap: the projectMetadata subscriber asks on every
    // real ingest, and this claim keeps that to one commit per project per
    // window. See RedisTopicClusteringBootstrapAdapter for why re-asking is safe.
    const topicClusteringBootstrap = RedisTopicClusteringBootstrapAdapter.create({
      redis: this.deps.redis,
      bootstrap: (projectId) =>
        commands.requestClustering({
          tenantId: projectId,
          occurredAt: Date.now(),
          trigger: "bootstrap",
        }),
    });
    this.bootstrapTopicClustering.resolve((projectId) =>
      topicClusteringBootstrap.claimAndBootstrap(projectId),
    );

    return { pipeline };
  }

  /** Langy writes its low-latency operational projections directly to Postgres. */
  private registerLangyConversationPipeline() {
    const conversationStore = this.deps.repositories.langyConversationState;
    const failTurn = new Deferred<
      (args: {
        projectId: string;
        conversationId: string;
        turnId: string;
        error: string;
      }) => Promise<void>
    >("langyFailTurn");
    const saveTitle = new Deferred<
      (args: {
        projectId: string;
        conversationId: string;
        turnId: string;
        title: string;
        model: string;
      }) => Promise<void>
    >("langyGenerateTitle");

    const effectPorts = createLangyEffectPorts({
      handoffStore: this.deps.langy.handoffStore,
      worker: this.deps.langy.worker,
      mintSessionKey: ({ userId, projectId, organizationId }) =>
        this.deps.langy.sessionKeys.mintForUser({ userId, projectId, organizationId }),
      revokeSessionKey: ({ apiKeyId, projectId }) =>
        this.deps.langy.sessionKeys.revoke({ apiKeyId, projectId }),
      titleGenerator: this.deps.langy.titleGenerator,
      saveTitle: (args) => saveTitle.fn(args),
      failTurn: { failTurn: (args) => failTurn.fn(args) },
      markError: (args) => this.deps.langy.buffer.markError(args),
    });
    const conversationReader = {
      read: async ({
        projectId,
        conversationId,
      }: {
        projectId: string;
        conversationId: string;
      }) => {
        const projection = await conversationStore.tryLoad(conversationId, {
          tenantId: createTenantId(projectId),
          aggregateId: conversationId,
        });
        if (!projection) return null;
        return {
          cursor: projection.cursor,
          status: projection.state.Status,
          currentTurnId: projection.state.CurrentTurnId,
          lastActivityAtMs: projection.state.LastActivityAt,
          ownerUserId: projection.state.UserId,
          isShared: projection.state.IsShared,
        };
      },
    };

    const livenessSubscriber = createAgentTurnLivenessSubscriber({
      buffer: this.deps.langy.buffer,
      conversations: conversationReader,
      failTurn: { failTurn: (args) => failTurn.fn(args) },
      worker: this.deps.langy.worker,
      handoffStore: this.deps.langy.handoffStore,
    });
    const broadcastSubscriber = createLangyConversationUpdateBroadcastSubscriber({
      broadcast: this.deps.broadcast,
      conversations: conversationReader,
    });
    const admissionLifecycleSubscriber = createLangyTurnAdmissionLifecycleSubscriber({
      admissions: this.deps.repositories.langyTurnAdmission,
    });

    const pipeline = this.deps.eventSourcing.register(
      createLangyConversationProcessingPipeline({
        langyConversationProjectionStore: conversationStore,
        langyConversationTurnProjectionStore: this.deps.repositories.langyConversationTurnState,
        langyMessageProjectionStore: this.deps.repositories.langyMessageStorage,
        langyAnalyticsEventProjectionStore: this.deps.repositories.langyAnalyticsEventStorage,
        langyProcessPorts: effectPorts,
        subscribers: [livenessSubscriber, broadcastSubscriber, admissionLifecycleSubscriber],
      }),
    );

    const commands = mapCommands(pipeline.commands);
    failTurn.resolve((args) =>
      commands.failAgentResponse({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        error: args.error,
      }),
    );
    saveTitle.resolve((args) =>
      commands.generateConversationTitle({
        tenantId: args.projectId,
        occurredAt: Date.now(),
        conversationId: args.conversationId,
        turnId: args.turnId,
        title: args.title,
        source: "auto",
        model: args.model,
      }),
    );
    // The outbox worker, dispatcher and process service are owned by
    // ProcessRuntime now that the process is declared on the pipeline; the
    // registry no longer constructs or starts them.
    return { pipeline };
  }

  private registerMetricPipeline({
    subscribers,
  }: {
    subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
  }) {
    return this.deps.eventSourcing.register(
      this.deps.metricProcessing.buildProcessing({
        subscribers,
      }),
    );
  }

  /**
   * ADR-056: the session-aggregate pipeline. Contribution commands are its
   * write surface; the session fold and the (trace → session) map are its
   * projections. The dispatch subscribers that feed it mount on the source
   * pipelines and close over this pipeline's commands, so this registers
   * first.
   */
  /**
   * The spend-command spine: gateway requests as aggregates, spend records
   * as a fold projection over gateway_spend, rating in the pipeline. Only
   * registered when ClickHouse is on (the spend table has no PG fallback).
   */
  private registerGovernanceEventsPipeline() {
    return this.deps.eventSourcing.register(
      createGovernanceEventsPipeline({
        webhookDelivery: this.deps.webhookDelivery
          ? AppGovernanceWebhookAdapter.create(this.deps.webhookDelivery).build()
          : undefined,
      }),
    );
  }

  private registerGatewaySpendPipeline(
    deps: { port: GatewaySpendEventsPort },
    governanceDelivery: GovernanceSignalDeliveryPort,
  ) {
    return this.deps.eventSourcing.register(
      createGatewaySpendProcessingPipeline({
        gatewaySpendStore: this.cached<GatewaySpendState>(
          new GatewaySpendStore(deps.port),
          "gateway_spend",
        ),
        // The ADR-073 delivery process manager consumes this pipeline's
        // committed events through its transactional inbox.
        webhookDelivery: this.deps.webhookDelivery,
        gatewayDebits: this.createGatewayDebits(governanceDelivery),
        settlement: {
          // Lazy: the pipeline is being built by this very call, so the
          // sweeper resolves the command sender at execution time.
          sendSettleSpend: async (data) => {
            const pipeline = this.deps.eventSourcing.getPipeline(
              GATEWAY_SPEND_PIPELINE_NAME as never,
            ) as unknown as {
              commands: {
                settleSpend: { send: (d: unknown) => Promise<unknown> };
              };
            };
            await pipeline.commands.settleSpend.send(data);
          },
          // Every configured instance, shared and private alike: one sweeper
          // settles the whole install, so it cannot hold a single client.
          //
          // Settled per instance, never all-or-nothing. `Promise.all` is
          // fail-fast, so one unreachable private ClickHouse would reject the
          // whole read, fail the sweep intent, burn its attempts and keep
          // failing every wake while that instance was down — taking the
          // SHARED instance's open admissions with it. That contradicts the
          // rule the sweep already states for a single tenant's failure, so
          // it applies at the instance level too: the reachable instances
          // settle, the unreachable one is reported and retried next sweep.
          findOpenAdmissions: async (params) => {
            const finders = await getOpenAdmissionFindersByInstance();
            const results = await Promise.allSettled(
              finders.map(({ finder }) => finder.findOpenAdmissions(params)),
            );
            const open: OpenAdmission[] = [];
            results.forEach((result, index) => {
              if (result.status === "fulfilled") {
                open.push(...result.value);
                return;
              }
              logger.warn(
                {
                  target: finders[index]?.target,
                  error: result.reason,
                },
                "settlement sweep could not read one ClickHouse instance; its open admissions wait for the next sweep",
              );
            });
            // The cap bounds ONE SWEEP, and each instance applies it to its own
            // query — so N instances would hand the sweeper N times the cap.
            // Re-applying it here is what makes the documented bound true of
            // the number the sweeper actually settles.
            //
            // Oldest first, across instances, so the cap sheds the newest rows
            // rather than whichever instance happened to answer last. Each
            // query already returns its own rows oldest-first; this is what
            // extends that ordering to the merge, and it keeps the sweep
            // draining a backlog from the end that has waited longest.
            open.sort((a, b) => a.admittedAtMs - b.admittedAtMs);
            return open.slice(0, MAX_OPEN_ADMISSIONS_PER_SWEEP);
          },
        },
      }),
    );
  }

  private createGatewayDebits(governanceDelivery: GovernanceSignalDeliveryPort) {
    const gateway = this.deps.gatewayDebits;
    if (!gateway) return undefined;

    return AppGatewayDebitAdapter.create(gateway, governanceDelivery).build();
  }

  private registerCodingAgentPipeline(costMetrics: PrometheusCodingAgentCostMetricsAdapter) {
    return this.deps.eventSourcing.register(
      EventingCodingAgentProcessingAdapter.create({
        traceCanonicalisation: this.deps.traceCanonicalisation,
        modelProviders: this.deps.modelProviders,
        costMetrics,
        projections: this.deps.repositories.codingAgentProjections,
        projects: this.deps.projects,
        clock: SystemCodingAgentClock.create(),
        redis: this.deps.redis,
        defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        ...(this.deps.codingAgent
          ? {
              github: this.deps.codingAgent.github,
            }
          : {}),
      }).build(),
    );
  }

  private registerLogPipeline({
    subscribers,
  }: {
    subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
  }) {
    return this.deps.eventSourcing.register(
      this.deps.logProcessing.buildProcessing({
        subscribers,
      }),
    );
  }

  private registerEvaluationPipeline({
    automations,
  }: {
    automations: AutomationEvaluationSubscriberService;
  }) {
    const evaluationExecutionIntent = EvaluationExecutionIntentService.create({
      monitors: this.deps.monitors,
      traces: this.deps.traces.tree,
      executionReceipt: AppEvaluationExecutionReceiptPort.create({
        prisma: this.deps.prisma,
        evaluations: this.deps.evaluations,
        costs: this.deps.costRecorder,
      }),
      azureSafetyCredentials: AppEvaluationAzureSafetyCredentialsPort.create(
        this.deps.modelProviders,
      ),
      // Emergency operator rollback for the langwatch#6397 settings recovery.
      // Without this line the flag is inert: the command defaults an absent
      // resolver to "not disabled", so /ops/feature-flags would report the
      // switch as available while flipping it changed nothing. The command
      // catches a rejection here and stays on the shipped default (recovery
      // ACTIVE) — an unreadable kill switch must not fail evaluations.
      settingsRecovery: this.deps.evaluationControls.settingsRecovery,
      inputsOffload: this.deps.evaluationControls.inputsOffload,
    });
    const executeEvaluationCommand = ExecuteEvaluationCommand.create(evaluationExecutionIntent);

    const evaluationStores = EvaluationEventingAdapter.create({
      evaluation: this.deps.evaluations,
      analytics: this.deps.analytics,
      attributePolicy: new TraceAnalyticsAttributePolicy(),
      retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
    }).buildStores();

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: evaluationStores.evalRunStore,
        evaluationAnalyticsStore: this.cached(
          evaluationStores.evaluationAnalyticsStore,
          "evaluation_analytics",
        ),
        evaluationAnalyticsRollupAppendStore: evaluationStores.evaluationAnalyticsRollupAppendStore,
        executeEvaluationCommand,
        automations,
      }),
    );
  }

  private registerTracePipeline({
    evaluationCommands,
    traceSummaryStore,
    automations,
    codingAgentSubscribers,
  }: {
    evaluationCommands: EvaluationPipelineCommands;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    automations: TraceProcessingPipelineDeps["automations"];
    codingAgentSubscribers: TraceProcessingPipelineDeps["subscribers"];
  }) {
    const evalCommands = evaluationCommands;

    // Deferred dispatchers — resolved after pipeline registration.
    const resolveOrigin = new Deferred<CommandDispatcher<ResolveOriginCommandData>>(
      "resolveOrigin",
    );
    const scheduleDeferred = new Deferred<(payload: DeferredOriginPayload) => Promise<void>>(
      "scheduleDeferred",
    );
    const simComputeRunMetrics = new Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>(
      "simComputeRunMetrics",
    );

    const originGateHandler = createOriginGateHandler({
      scheduleDeferred: scheduleDeferred.fn,
    });

    const evaluationTrigger = createEvaluationTriggerSubscriber({
      featureFlags: this.deps.featureFlags,
      monitors: this.deps.monitors,
      evaluation: evalCommands.executeEvaluation,
    });

    const customEvaluationSyncHandler = createCustomEvaluationSyncHandler({
      reportEvaluation: evalCommands.reportEvaluation,
    });

    // Live span feedback (langwatch.event) → tracked event. Routes through the
    // same recordTrackedEventSpan path as REST POST /api/events/track so an
    // SDK-emitted thumbs_up_down lands identically to a REST call.
    const trackedEventSyncHandler = createTrackedEventSyncHandler({
      recordTrackedEvent: ({ tenantId, body, eventId }) =>
        recordTrackedEventSpan({ project: { id: tenantId }, body, eventId }),
    });

    const broadcastDisabled = false;

    const traceUpdateBroadcastHandler = createTraceUpdateBroadcastHandler({
      broadcast: this.deps.broadcast,
    });

    const spanStorageBroadcastHandler = createSpanStorageBroadcastHandler({
      broadcast: this.deps.broadcast,
    });

    const projectMetadataHandler = createProjectMetadataHandler({
      projects: this.deps.projects,
      bootstrapTopicClustering: (projectId) => this.bootstrapTopicClustering.fn(projectId),
    });

    const simulationMetricsSyncHandler = createSimulationMetricsSyncHandler({
      computeRunMetrics: simComputeRunMetrics.fn,
    });

    // Late-bound reference for experiment metrics sync subscriber.
    // The experiment pipeline is registered after the trace pipeline,
    // so computeExperimentRunMetrics is wired after experiment pipeline registration.
    let expComputeRunMetrics:
      | ((data: ComputeExperimentRunMetricsCommandData) => Promise<void>)
      | null = null;
    let expLookupExperimentId:
      | ((tenantId: string, runId: string) => Promise<string | null>)
      | null = null;

    const experimentMetricsSyncHandler = createExperimentMetricsSyncHandler({
      computeExperimentRunMetrics: async (data) => {
        if (!expComputeRunMetrics) {
          logger.warn("experiment computeExperimentRunMetrics not yet initialized, skipping");
          return;
        }
        return expComputeRunMetrics(data);
      },
      lookupExperimentId: async (tenantId, runId) => {
        if (!expLookupExperimentId) {
          logger.warn("experiment lookupExperimentId not yet initialized, skipping");
          return null;
        }
        return expLookupExperimentId(tenantId, runId);
      },
    });

    // EE governance rollups, composed here as full subscriber specs so the
    // OSS pipeline definition stays free of `@ee` imports.
    const governanceSubscribers = AppGovernanceSubscriberAdapter.create(
      this.governanceSubscriberRuntime,
    );
    const governanceKpis = this.deps.governanceKpisSync
      ? governanceSubscribers.kpis(this.deps.governanceKpisSync.governanceKpisRepository)
      : undefined;
    const governanceKpisSync = governanceKpis
      ? {
          fold: "traceSummary" as const,
          when: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
            governanceKpis.when(event, context),
          ...throttledWindow<TraceProcessingEvent>({
            makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
            windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
          }),
          handler: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
            governanceKpis.handle(event, context),
        }
      : undefined;

    const governanceOcsf = this.deps.governanceOcsfEventsSync
      ? governanceSubscribers.ocsf(
          this.deps.governanceOcsfEventsSync.governanceOcsfEventsRepository,
        )
      : undefined;
    const governanceOcsfEventsSync = governanceOcsf
      ? {
          fold: "traceSummary" as const,
          when: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
            governanceOcsf.when(event, context),
          ...throttledWindow<TraceProcessingEvent>({
            makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
            windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
          }),
          handler: (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) =>
            governanceOcsf.handle(event, context),
        }
      : undefined;

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        recordSpanCommand: AppTraceRecordSpanAdapter.create({
          modelProviders: this.deps.modelProviders,
          featureFlags: this.deps.featureFlags,
          blobStore: this.deps.blobStore,
        }),
        traceCanonicalisation: this.deps.traceCanonicalisation,
        spanAppendStore: SpanStorageStore.create({
          storage: this.deps.traceProjectionStorage.spans,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        }),
        traceAnalyticsRollupAppendStore: TraceAnalyticsRollupStore.create({
          storage: this.deps.traceProjectionStorage.analyticsRollup,
          defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        }),
        // Redis cache is the slim fold's warm read path; a miss now falls
        // through to the store's own ClickHouse read-back (ADR-066, migration
        // 00056) rather than re-folding the event log. The wrapper still earns
        // its keep — it keeps the steady state off ClickHouse entirely.
        traceAnalyticsStore: this.cached<TraceAnalyticsData>(
          TraceAnalyticsStore.create({
            storage: this.deps.traceProjectionStorage.analytics,
            defaultRetentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          }),
          "trace_analytics",
        ),
        traceSummaryStore,
        originGateHandler,
        evaluationTrigger,
        automations,
        customEvaluationSyncHandler,
        trackedEventSyncHandler,
        traceUpdateBroadcastHandler,
        projectMetadataHandler,
        simulationMetricsSyncHandler,
        experimentMetricsSyncHandler,
        spanStorageBroadcastHandler,
        broadcastDisabled,
        // Span-command sharding fan-out (env TRACE_SPAN_PROCESSING_SHARDS,
        // default 1 = disabled). Lets a hot trace's recordSpan commands drain in
        // parallel across `traceId:<shard>` GroupQueue groups; fold stays per-trace.
        spanCommandShardCount: resolveSpanCommandShardCount(
          process.env.TRACE_SPAN_PROCESSING_SHARDS,
        ),
        governanceKpisSync,
        governanceOcsfEventsSync,
        subscribers: codingAgentSubscribers,
      }),
    );

    // Resolve self-referencing commands now that the pipeline is registered
    const traceCommands = mapCommands(tracePipeline.commands);
    resolveOrigin.resolve(traceCommands.resolveOrigin);

    // Wire the deferred origin resolution queue (GroupQueue-backed, survives process restart).
    // After 5 min, dispatches resolveOrigin command → OriginResolvedEvent → fold → subscriber.
    const deferredOriginHandler = createDeferredOriginHandler(resolveOrigin.fn);
    const deferredOriginQueue = tracePipeline.service.registerJob<DeferredOriginPayload>({
      name: "deferredOriginResolution",
      process: deferredOriginHandler,
      delay: DEFERRED_CHECK_DELAY_MS,
      deduplication: {
        makeId: makeDeferredJobId,
        ttlMs: DEFERRED_CHECK_DELAY_MS + 60_000, // 6 min — covers the 5-min delay + buffer
        extend: false, // Don't reset the 5-min timer on new spans
        replace: false, // Don't update payload (same trace, same data)
      },
      groupKeyFn: (p) => p.traceId, // Per-trace parallelism (framework prepends tenantId)
      spanAttributes: (payload) => ({
        "deferred.tenant_id": payload.tenantId,
        "deferred.trace_id": payload.traceId,
      }),
    });

    if (deferredOriginQueue) {
      scheduleDeferred.resolve((payload) => deferredOriginQueue.send(payload));
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout (best-effort)
      scheduleDeferred.resolve(
        createInMemoryDeferredFallback({
          makeId: makeDeferredJobId,
          delayMs: DEFERRED_CHECK_DELAY_MS,
          process: deferredOriginHandler,
          logContext: (p) => ({ tenantId: p.tenantId, traceId: p.traceId }),
          errorMessage: "Deferred origin resolution failed",
        }),
      );
    }

    // ADR-032 D5: the Dataset package owns normalization and its persistence;
    // this process root only mounts the durable queue and hands the sender back
    // to that process-owned capability.
    const datasetNormalizeQueue = tracePipeline.service.registerJob<DatasetNormalizePayload>({
      name: "datasetNormalize",
      process: (payload) => this.deps.datasetNormalization.process(payload),
      // The per-dataset group key already serializes to concurrency-1, so no
      // deduplication block is needed; the 200ms debounce default is
      // surprising and could swallow a fast retry (m1).
      groupKeyFn: (p) => p.datasetId,
    });

    if (datasetNormalizeQueue) {
      this.deps.datasetNormalization.connect((payload) => datasetNormalizeQueue.send(payload));
    }
    // With no queue, the same capability runs its serialized inline fallback.

    return {
      pipeline: tracePipeline,
      traceSummaryStore,
      /** Cross-pipeline deferred — resolved by registerSimulationPipeline. */
      simComputeRunMetrics,
      /**
       * Wires late-bound experiment computeExperimentRunMetrics and
       * lookupExperimentId into the trace-side experimentMetricsSync subscriber.
       * Called after the experiment pipeline is registered.
       */
      wireExperimentDeps: (deps: {
        computeExperimentRunMetrics: (
          data: ComputeExperimentRunMetricsCommandData,
        ) => Promise<void>;
        lookupExperimentId: (tenantId: string, runId: string) => Promise<string | null>;
      }) => {
        expComputeRunMetrics = deps.computeExperimentRunMetrics;
        expLookupExperimentId = deps.lookupExperimentId;
      },
    };
  }

  private registerSuiteRunPipeline() {
    return this.deps.eventSourcing.register(
      createSuiteRunProcessingPipeline({
        suiteRunStateFoldStore: this.cached<SuiteRunStateData>(
          new RepositoryFoldStore<SuiteRunStateData>(
            this.deps.suiteRunState,
            SUITE_RUN_PROJECTION_VERSIONS.RUN_STATE,
          ),
          "suite_runs",
        ),
      }),
    );
  }

  private registerSimulationPipeline({
    suiteRunPipeline,
    traceSummaryStore,
    simComputeRunMetrics,
  }: {
    suiteRunPipeline: ReturnType<PipelineRegistry["registerSuiteRunPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    simComputeRunMetrics: Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>;
  }) {
    const simulationRunStore = this.cached(
      this.deps.repositories.simulationRunState.createFoldStore(),
      "simulation_runs",
    );

    const suiteRunCommands = mapCommands(suiteRunPipeline.commands);

    // Deferred dispatchers — resolved after pipeline registration.
    const selfComputeRunMetrics = new Deferred<CommandDispatcher<ComputeRunMetricsCommandData>>(
      "selfComputeRunMetrics",
    );
    const scheduleRetry = new Deferred<(payload: ComputeRunMetricsCommandData) => Promise<void>>(
      "scheduleRetry",
    );
    const traceReadDerivation = new TraceReadDerivationService(this.deps.traces.spans);
    const computeRunMetricsCommand = new ComputeRunMetricsCommand({
      traceSummaryStore,
      scheduleRetry: scheduleRetry.fn,
      deriveScenarioRoleMetrics: (params) => traceReadDerivation.deriveScenarioRoleMetrics(params),
    });

    // ECST backfill: FinishRunCommand loads the run's prior events straight
    // from the canonical event store (aggregateType "simulation_run").
    const finishRunCommand = new FinishRunCommand({
      loadPriorEvents: async ({ tenantId, scenarioRunId }) => {
        const eventStore = this.deps.eventSourcing.getEventStore<SimulationProcessingEvent>();
        if (!eventStore) return [];
        return eventStore.getEvents(
          scenarioRunId,
          { tenantId: createTenantId(tenantId) },
          "simulation_run",
        );
      },
    });

    const simulationPipeline = this.deps.eventSourcing.register(
      SimulationProcessingPipelineAdapter.create({
        simulationRunStore,
        simulationRunMetricsStore: this.deps.repositories.simulationRunMetricsStore,
        finishRunCommand,
        computeRunMetricsCommand,
        scenarioRunExecution: {
          name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
          process: simulationRunExecutionPM(this.deps.scenarioExecutions, this.deps.simulations),
        },
        simulations: this.deps.simulations,
        snapshotUpdateBroadcast: {
          broadcastUpdate: async ({ tenantId, payload }) =>
            this.deps.broadcast.broadcastToTenant(tenantId, payload, "simulation_updated"),
        },
        suiteRunSync: {
          recordSuiteRunItemStarted: async (data) => {
            const command = suiteRunCommands.recordSuiteRunItemStarted;
            if (!command)
              throw new Error("Suite run pipeline is missing recordSuiteRunItemStarted");
            await command(data);
          },
          completeSuiteRunItem: async (data) => {
            const command = suiteRunCommands.completeSuiteRunItem;
            if (!command) throw new Error("Suite run pipeline is missing completeSuiteRunItem");
            await command(data);
          },
        },
        traceMetricsSync: {
          computeRunMetrics: selfComputeRunMetrics.fn,
        },
      }),
    );

    // Resolve self-referencing command
    const simCommands = mapCommands(simulationPipeline.commands);
    selfComputeRunMetrics.resolve(simCommands.computeRunMetrics);

    // Resolve cross-pipeline deferred (trace → simulation)
    simComputeRunMetrics.resolve(simCommands.computeRunMetrics);

    // Resolve deferred retry job
    const retryJobId = (payload: ComputeRunMetricsCommandData) =>
      `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`;

    const retryQueue = simulationPipeline.service.registerJob<ComputeRunMetricsCommandData>({
      name: "deferredComputeRunMetrics",
      process: async (payload) => {
        await simCommands.computeRunMetrics(payload);
      },
      delay: COMPUTE_METRICS_RETRY_DELAY_MS,
      deduplication: {
        makeId: retryJobId,
        extend: false,
        replace: true,
      },
      spanAttributes: (payload) => ({
        "deferred.tenant_id": payload.tenantId,
        "deferred.scenario_run_id": payload.scenarioRunId,
        "deferred.trace_id": payload.traceId,
        "deferred.retry_count": payload.retryCount,
      }),
    });

    if (retryQueue) {
      scheduleRetry.resolve((payload) => retryQueue.send(payload));
    } else {
      // Fallback: event sourcing disabled, use in-memory setTimeout
      scheduleRetry.resolve(
        createInMemoryDeferredFallback({
          delayMs: COMPUTE_METRICS_RETRY_DELAY_MS,
          process: (payload) => simCommands.computeRunMetrics(payload),
          logContext: (p) => ({
            tenantId: p.tenantId,
            scenarioRunId: p.scenarioRunId,
            traceId: p.traceId,
          }),
          errorMessage: "Deferred compute metrics retry failed",
        }),
      );
    }

    return simulationPipeline;
  }

  private registerBillingReportingPipeline() {
    const reportUsageForMonthCommand = new ReportUsageForMonthCommand({
      organizations: this.deps.organizations,
      billingCheckpoints: this.deps.billingCheckpoints,
      getUsageReportingService: () => this.deps.usageReportingService,
      queryBillableEventsTotal: (input) => getApp().billingQueries.queryBillableEventsTotal(input),
      selfDispatch: (data) => {
        const pipeline = this.deps.eventSourcing.getPipeline(BILLING_REPORTING_PIPELINE_NAME);
        return pipeline.commands.reportUsageForMonth.send(data);
      },
    });

    return this.deps.eventSourcing.register(
      createBillingReportingPipeline({
        reportUsageForMonthCommand,
      }),
    );
  }

  private registerExperimentRunPipeline({
    wireExperimentDeps,
  }: {
    wireExperimentDeps: ReturnType<PipelineRegistry["registerTracePipeline"]>["wireExperimentDeps"];
  }) {
    const experimentRunStore = this.cached<ExperimentRunStateData>(
      createExperimentRunStateFoldStore(this.deps.repositories.experimentRunState),
      "experiment_runs",
    );

    const experimentRunPipeline = this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore: experimentRunStore,
        experimentRunItemAppendStore: this.deps.repositories.experimentRunItemStorage,
      }),
    );

    // Wire the trace-side experimentMetricsSync subscriber's late-bound deps
    const expCommands = mapCommands(experimentRunPipeline.commands);

    // The experimentId lookup, pre-built at the composition root (presets.ts)
    // over the App's ClickHouse resolver — the registry consumes it directly,
    // it does not resolve a client itself (see PipelineRepositories above).
    const lookupExperimentId = async (tenantId: string, runId: string): Promise<string | null> => {
      try {
        return await this.deps.repositories.experimentIdLookup.findExperimentId({
          tenantId,
          runId,
        });
      } catch (error) {
        logger.warn(
          { tenantId, runId, error },
          "Failed to lookup experimentId for trace metrics sync",
        );
        return null;
      }
    };

    wireExperimentDeps({
      computeExperimentRunMetrics: expCommands.computeExperimentRunMetrics,
      lookupExperimentId,
    });

    return experimentRunPipeline;
  }
}

export type AppCommands = ReturnType<PipelineRegistry["registerAll"]>;

// ============================================================================
// Introspection — derived from the live EventSourcing runtime
// ============================================================================

import { getApp } from "../../app-layer/app";
// StaticPipelineDefinition is already imported at the top of the file.

export interface ProjectionMetadata {
  projectionName: string;
  pipelineName: string;
  aggregateType: string;
  source: "pipeline" | "global";
  pauseKey: string;
  kind: "fold" | "map" | "state";
}

export interface SubscriberMetadata {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  afterProjection: string;
}

export interface EventSubscriberMetadata {
  subscriberName: string;
  pipelineName: string;
  aggregateType: string;
  /** The event types this subscriber reacts to — its transition triggers. */
  eventTypes: readonly string[];
}

export interface DejaViewProjection {
  projectionName: string;
  eventTypes: readonly string[];
  init: () => unknown;
  apply: (state: unknown, event: { type: string }) => unknown;
}

function getDefinitions(): ReadonlyArray<StaticPipelineDefinition<any, any, any>> {
  return getApp().eventSourcing?.definitions ?? [];
}

export function getProjectionMetadata(): ProjectionMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    const folds = Array.from(def.foldProjections.values()).map(({ definition }) => ({
      projectionName: definition.name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      pauseKey: `${pipelineName}/projection/${definition.name}`,
      kind: "fold" as const,
    }));
    const maps = Array.from(def.mapProjections.values()).map(({ definition }) => ({
      projectionName: definition.name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      // Maps run as `__jobType=handler` in the GroupQueue, so the pause-set
      // entry must use the `handler` segment to match the dispatcher's Lua check.
      pauseKey: `${pipelineName}/handler/${definition.name}`,
      kind: "map" as const,
    }));
    const states = Array.from(def.stateProjections?.entries() ?? []).map(([name]) => ({
      projectionName: name,
      pipelineName,
      aggregateType,
      source: "pipeline" as const,
      // State projections enqueue with `__jobType=stateProjection`; the
      // dispatcher matches the pause key against that raw segment.
      pauseKey: `${pipelineName}/stateProjection/${name}`,
      kind: "state" as const,
    }));
    return [...folds, ...maps, ...states];
  });
}

export function getSubscriberMetadata(): SubscriberMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.foldSubscribers.values()).map(({ projectionName, definition }) => ({
      subscriberName: definition.name,
      pipelineName,
      aggregateType,
      afterProjection: projectionName,
    }));
  });
}

/**
 * Event subscribers registered on each pipeline — live consumers of committed
 * events that carry no projection state. This is the DejaView-facing view of
 * the `.withEventSubscriber(...)` seam; the
 * process-manager runtime's generated `pm:<name>` subscribers are internal
 * plumbing and are not part of the static definition, so they are not listed.
 */
export function getEventSubscriberMetadata(): EventSubscriberMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.eventSubscribers.values()).map((definition) => ({
      subscriberName: definition.name,
      pipelineName,
      aggregateType,
      eventTypes: definition.eventTypes,
    }));
  });
}

export interface ProcessManagerMetadata {
  processName: string;
  pipelineName: string;
  aggregateType: string;
  /** Event types that drive the machine's transitions. */
  eventTypes: readonly string[];
  /**
   * Intent types the machine can emit — its cross-aggregate commands, dispatched
   * through the transactional outbox.
   */
  intentTypes: string[];
  /**
   * True for a fixed-interval singleton (one instance, project `__global__`);
   * false for a per-aggregate machine keyed by aggregate id.
   */
  scheduled: boolean;
  /** Fixed wake interval in ms for a scheduled singleton, else null. */
  everyMs: number | null;
  /** True when the machine computes its own wake-ups from within `evolve`. */
  hasWake: boolean;
}

/**
 * The process-manager state machines mounted across the pipelines.
 *
 * The machine itself is implicit in each manager's `evolve` — there is no
 * declared state set or transition table — so what is introspectable is the
 * definition surface: which event types trigger it, which intents it can emit,
 * and how it wakes. The per-aggregate *position* in the machine lives in the
 * persisted instance, read separately by ref.
 */
export function getProcessManagerMetadata(): ProcessManagerMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.processManagers.values()).map(({ config }) => ({
      processName: config.name,
      pipelineName,
      aggregateType,
      eventTypes: config.eventTypes,
      intentTypes: Object.keys(config.intents ?? {}),
      scheduled: Boolean(config.schedule),
      everyMs: config.schedule?.everyMs ?? null,
      hasWake: Boolean(config.onWake),
    }));
  });
}

export function getDejaViewProjections(): DejaViewProjection[] {
  return getDefinitions().flatMap((def) =>
    Array.from(def.foldProjections.values()).map(({ definition: d }) => ({
      projectionName: d.name,
      eventTypes: d.eventTypes,
      init: () => d.init(),
      apply: (state: unknown, event: { type: string }) => d.apply(state, event as any),
    })),
  );
}
