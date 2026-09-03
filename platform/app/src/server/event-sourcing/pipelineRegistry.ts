import {
  type EnterprisePipelineSetConfig,
  registerEnterprisePipelineSet,
} from "@ee/event-sourcing/pipelineSet";
import type { GatewayDebitsProcessDeps } from "@ee/governance/process-manager/gatewayDebits.process";
import {
  createGovernanceKpisSyncHandler,
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  type GovernanceKpisSyncSubscriberDeps,
  isGovernanceKpiTrace,
} from "@ee/governance/subscribers/governanceKpisSync.subscriber";
import {
  createGovernanceOcsfEventsSyncHandler,
  GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
  type GovernanceOcsfEventsSyncSubscriberDeps,
  isGovernanceOcsfTrace,
} from "@ee/governance/subscribers/governanceOcsfEventsSync.subscriber";
import { createTraceAlertTriggerMatchHandler } from "@ee/governance/subscribers/traceAlertTriggerMatch.subscriber";
import type { WebhookDeliveryProcessDeps } from "@ee/webhooks/process-manager/webhookDelivery.process";
import type {
  IdentityHeadsRepository,
  IdentityReservationRepository,
  IdentityUsersRepository,
  JoinRequestReadRepository,
  MfaEnrollmentRepository,
  ScimSyncReadRepository,
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoPlatformOperatorRepository,
} from "@langwatch/identity-server";
import {
  IdentityGuards,
  JoinRequestGuards,
  MfaGuards,
  ScimSyncGuards,
  SsoConnectionGuards,
} from "@langwatch/identity-server";
import type {
  LangyConversationStateData,
  LangyConversationTurnData,
  LangyMessageProjectionRecord,
} from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import type { PrismaClient } from "~/generated/prisma/client";
import { reapExpiredAgentSandboxApiKeys } from "~/server/api-key/agent-sandbox-key";
import { recordTrackedEventSpan } from "~/server/app-layer/events/track-event.service";
import { reapExpiredLangySessionApiKeys } from "~/server/app-layer/langy/langyApiKey";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { DatasetRepository } from "~/server/datasets/dataset.repository";
import {
  createDatasetNormalizeHandler,
  type DatasetNormalizePayload,
} from "~/server/datasets/dataset-normalize.job";
import { registerDatasetNormalizeEnqueue } from "~/server/datasets/dataset-normalize.queue";
import { getDatasetStorage } from "~/server/datasets/dataset-storage";
import { featureFlagService } from "~/server/featureFlag";
import type { GatewaySpendEventsRepository } from "~/server/gateway/spendEvents.clickhouse.repository";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import { queryBillableEventsTotal } from "../../../ee/billing/services/billableEventsQuery";
import type { UsageReportingService } from "../../../ee/billing/services/usageReportingService";
import type { TriggerService } from "../app-layer/automations/trigger.service";
import type { BillingCheckpointService } from "../app-layer/billing/billingCheckpoint.service";
import type { BroadcastService } from "../app-layer/broadcast/broadcast.service";
import type { CodingAgentSessionRepository } from "../app-layer/coding-agent/repositories/coding-agent-session.repository";
import type { CodingAgentSessionEventsRepository } from "../app-layer/coding-agent/repositories/coding-agent-session-events.repository";
import type { CodingAgentTraceSessionRepository } from "../app-layer/coding-agent/repositories/coding-agent-trace-session.repository";
import type { SessionMetricSeriesRepository } from "../app-layer/coding-agent/repositories/session-metric-series.repository";
import { getAzureSafetyEnvFromProject } from "../app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../app-layer/evaluations/evaluation-execution.service";
import { offloadInputsIfOversized } from "../app-layer/evaluations/evaluation-inputs-offload";
import type { EvaluationRunService } from "../app-layer/evaluations/evaluation-run.service";
import type { EvaluationAnalyticsRepository } from "../app-layer/evaluations/repositories/evaluation-analytics.repository";
import type { EvaluationAnalyticsRollupRepository } from "../app-layer/evaluations/repositories/evaluation-analytics-rollup.repository";
import type { LangyTitleGenerator } from "../app-layer/langy/langy-title-generation.service";
import {
  mintLangySessionApiKeyForUser,
  revokeLangySessionApiKey,
} from "../app-layer/langy/langyApiKey";
import type { LangyWorkerPort } from "../app-layer/langy/langyWorker";
import type { LangyTurnAdmissionRepository } from "../app-layer/langy/repositories/langy-turn-admission.repository";
import type { LangyTokenBuffer } from "../app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnHandoffStore } from "../app-layer/langy/streaming/langyTurnHandoff";
import {
  createAgentTurnLivenessSubscriber,
  createLangyConversationUpdateBroadcastSubscriber,
  createLangyTurnAdmissionLifecycleSubscriber,
} from "../app-layer/langy/subscribers";
import type { CanonicalLogRecordRepository } from "../app-layer/logs/repositories/canonical-log-record.repository";
import type { MetricDataPointRepository } from "../app-layer/metrics/repositories/metric-data-point.repository";
import type { MonitorService } from "../app-layer/monitors/monitor.service";
import type { OrganizationService } from "../app-layer/organizations/organization.service";
import type { ProjectService } from "../app-layer/projects/project.service";
import { createRateLimitedBootstrap } from "../app-layer/topic-clustering/topicClusteringBootstrapGate";
import type { TraceAnalyticsRepository } from "../app-layer/traces/repositories/trace-analytics.repository";
import type { TraceAnalyticsRollupRepository } from "../app-layer/traces/repositories/trace-analytics-rollup.repository";
import type { TraceSummaryRepository } from "../app-layer/traces/repositories/trace-summary.repository";
import type { SpanStorageService } from "../app-layer/traces/span-storage.service";
import { TraceReadDerivationService } from "../app-layer/traces/trace-read-derivation.service";
import type { TraceSummaryService } from "../app-layer/traces/trace-summary.service";
import type { TraceSummaryData } from "../app-layer/traces/types";
import type { RetentionPolicyResolver } from "../data-retention/retentionPolicyResolver";
import type { AutomationDispatchPorts } from "../event-sourcing/pipelines/automations/automationDispatch.wiring";
import { createEvaluationAlertTriggerMatchHandler } from "../event-sourcing/pipelines/automations/subscribers/evaluationAlertTriggerMatch.subscriber";
import { createGraphTriggerActivityHandler } from "../event-sourcing/pipelines/automations/subscribers/graphTriggerActivity.subscriber";
import { createLangyEffectPorts } from "../event-sourcing/pipelines/langy-conversation-processing/process-manager/langyEffectPorts";
import type {
  TopicClusteringOutcomeCommands,
  TopicClusteringRunPort,
} from "../event-sourcing/pipelines/topic-clustering-processing/process-manager";
import { publishCancellation } from "../scenarios/cancellation-channel";
import type { ScenarioExecutionPool } from "../scenarios/execution/execution-pool";
import { type CommandDispatcher, Deferred } from "./deferred";
import { createTenantId } from "./domain/tenantId";
import type { EventSourcing } from "./eventSourcing";
import { mapCommands } from "./mapCommands";
import type { StaticPipelineDefinition } from "./pipeline/staticBuilder.types";
import { createAgentSandboxMaintenancePipeline } from "./pipelines/agent-sandbox-maintenance/pipeline";
import { createAuthzGrantsPipeline } from "./pipelines/authz-grants/pipeline";
import type { GrantProjectionWriteStore } from "./pipelines/authz-grants/projections/authzGrantsWrite.projection";
import type { AuthzAuditTrailStore } from "./pipelines/authz-grants/subscribers/authzAuditTrail.subscriber";
import { createAutomationsPipeline } from "./pipelines/automations/pipeline";
import { ReportUsageForMonthCommand } from "./pipelines/billing-reporting/commands/reportUsageForMonth.command";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  createBillingReportingPipeline,
} from "./pipelines/billing-reporting/pipeline";
import { createBlobMaintenancePipeline } from "./pipelines/blob-maintenance/pipeline";
import { createCodingAgentProcessingPipeline } from "./pipelines/coding-agent-processing/pipeline";
import type { CodingAgentSessionState } from "./pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { CodingAgentSessionStore } from "./pipelines/coding-agent-processing/projections/codingAgentSession.store";
import { createCodingAgentSessionSeenTouch } from "./pipelines/coding-agent-processing/projections/codingAgentSessionSeen.touch";
import {
  CodingAgentSessionEventsAppendStore,
  CodingAgentTraceSessionAppendStore,
  SessionMetricSeriesAppendStore,
} from "./pipelines/coding-agent-processing/projections/stores";
import { RedisSessionContextMemo } from "./pipelines/coding-agent-processing/services/session-context-memo";
import { createCodingAgentLogFactsDispatchSubscriber } from "./pipelines/coding-agent-processing/subscribers/codingAgentLogFactsDispatch.subscriber";
import { createCodingAgentMetricFactsDispatchSubscriber } from "./pipelines/coding-agent-processing/subscribers/codingAgentMetricFactsDispatch.subscriber";
import { createCodingAgentSpanFactsDispatchSubscriber } from "./pipelines/coding-agent-processing/subscribers/codingAgentSpanFactsDispatch.subscriber";
import {
  createPullRequestMappingHandler,
  type PullRequestMappingSubscriberDeps,
} from "./pipelines/coding-agent-processing/subscribers/pullRequestMapping.subscriber";
import { ExecuteEvaluationCommand } from "./pipelines/evaluation-processing/commands/executeEvaluation.command";
import {
  createEvaluationProcessingPipeline,
  type EvaluationProcessingPipelineDeps,
} from "./pipelines/evaluation-processing/pipeline";
import type { EvaluationAnalyticsData } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import { EvaluationAnalyticsStore } from "./pipelines/evaluation-processing/projections/evaluationAnalytics.store";
import { EvaluationAnalyticsRollupAppendStore } from "./pipelines/evaluation-processing/projections/evaluationAnalyticsRollup.store";
import { EvaluationRunStore } from "./pipelines/evaluation-processing/projections/evaluationRun.store";
import { createExperimentRunProcessingPipeline } from "./pipelines/experiment-run-processing/pipeline";
import type { ClickHouseExperimentRunResultRecord } from "./pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection";
import type { ExperimentRunStateData } from "./pipelines/experiment-run-processing/projections/experimentRunState.foldProjection";
import { createExperimentRunStateFoldStore } from "./pipelines/experiment-run-processing/projections/experimentRunState.store";
import type { ExperimentIdLookup } from "./pipelines/experiment-run-processing/repositories/experimentIdLookup.clickhouse.repository";
import type { ExperimentRunStateRepository } from "./pipelines/experiment-run-processing/repositories/experimentRunState.repository";
import type { ComputeExperimentRunMetricsCommandData } from "./pipelines/experiment-run-processing/schemas/commands";
import { createGatewaySpendProcessingPipeline } from "./pipelines/gateway-spend-processing/pipeline";
import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "./pipelines/gateway-spend-processing/process-manager/spendSettlement.process";
import type { GatewaySpendState } from "./pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { GatewaySpendStore } from "./pipelines/gateway-spend-processing/projections/gatewaySpend.store";
import type { OpenAdmission } from "./pipelines/gateway-spend-processing/repositories/openAdmissions.clickhouse.repository";
import { getOpenAdmissionFindersByInstance } from "./pipelines/gateway-spend-processing/repositories/openAdmissions.clickhouse.repository";
import { GATEWAY_SPEND_PIPELINE_NAME } from "./pipelines/gateway-spend-processing/schemas/constants";
import { createGithubMaintenancePipeline } from "./pipelines/github-maintenance/pipeline";
import { createGovernanceEventsPipeline } from "./pipelines/governance-events/pipeline";
import { createIdentityPipeline } from "./pipelines/identity/pipeline";
import type { IdentityFoldState } from "./pipelines/identity/projections/identityState.foldProjection";
import type { MfaFoldState } from "./pipelines/identity/projections/mfaEnrollmentState.foldProjection";
import { createJoinRequestPipeline } from "./pipelines/join-requests/pipeline";
import type { JoinRequestLifecyclePort } from "./pipelines/join-requests/process-manager/joinRequestLifecycle.process";
import type { JoinRequestFoldState } from "./pipelines/join-requests/projections/joinRequestState.foldProjection";
import { createLangyConversationProcessingPipeline } from "./pipelines/langy-conversation-processing/pipeline";
import type { LangyAnalyticsEventProjectionRecord } from "./pipelines/langy-conversation-processing/projections/langyAnalyticsEvent.mapProjection";
import { createLangyMaintenancePipeline } from "./pipelines/langy-maintenance/pipeline";
import { resolveLogCommandShardCount as resolveCanonicalLogCommandShardCount } from "./pipelines/log-processing/canonicalLog";
import { createLogProcessingPipeline } from "./pipelines/log-processing/pipeline";
import { CanonicalLogAppendStore } from "./pipelines/log-processing/projections/stores";
import { resolveMetricCommandShardCount } from "./pipelines/metric-processing/canonical/shards";
import { createMetricProcessingPipeline } from "./pipelines/metric-processing/pipeline";
import {
  MetricDataPointAppendStore,
  MetricSeriesCatalogAppendStore,
  MetricTimeRollupAppendStore,
} from "./pipelines/metric-processing/projections/stores";
import { createProcessManagerMaintenancePipeline } from "./pipelines/process-manager-maintenance/pipeline";
import { createScimSyncPipeline } from "./pipelines/scim-sync/pipeline";
import type { ScimSyncFoldState } from "./pipelines/scim-sync/projections/scimSyncState.foldProjection";
import {
  COMPUTE_METRICS_RETRY_DELAY_MS,
  ComputeRunMetricsCommand,
} from "./pipelines/simulation-processing/commands/computeRunMetrics.command";
import { FinishRunCommand } from "./pipelines/simulation-processing/commands/finishRun.command";
import { createSimulationProcessingPipeline } from "./pipelines/simulation-processing/pipeline";
import type { SimulationRunExecutionCommands } from "./pipelines/simulation-processing/process-manager";
import type { SimulationRunMetricsProjectionRecord } from "./pipelines/simulation-processing/projections/simulationRunMetrics.mapProjection";
import type { SimulationRunStateData } from "./pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import { SimulationRunStateFoldStore } from "./pipelines/simulation-processing/projections/simulationRunState.store";
import type { SimulationRunStateRepository } from "./pipelines/simulation-processing/repositories/simulationRunState.repository";
import type { ComputeRunMetricsCommandData } from "./pipelines/simulation-processing/schemas/commands";
import { SIMULATION_PROJECTION_VERSIONS } from "./pipelines/simulation-processing/schemas/constants";
import type { SimulationProcessingEvent } from "./pipelines/simulation-processing/schemas/events";
import { createSsoConnectionPipeline } from "./pipelines/sso-connections/pipeline";
import type { ConnectionTeardownPort } from "./pipelines/sso-connections/process-manager/connectionTeardown.process";
import type { SsoConnectionFoldState } from "./pipelines/sso-connections/projections/ssoConnectionState.foldProjection";
import { createSuiteRunProcessingPipeline } from "./pipelines/suite-run-processing/pipeline";
import type { SuiteRunStateData } from "./pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import type { SuiteRunStateRepository } from "./pipelines/suite-run-processing/repositories/suiteRunState.repository";
import { SUITE_RUN_PROJECTION_VERSIONS } from "./pipelines/suite-run-processing/schemas/constants";
import { createTopicClusteringProcessingPipeline } from "./pipelines/topic-clustering-processing/pipeline";
import type { TopicClusteringRunHistoryData } from "./pipelines/topic-clustering-processing/projections/topicClusteringRunHistory.foldProjection";
import type { TopicClusteringRunStatusData } from "./pipelines/topic-clustering-processing/projections/topicClusteringRunStatus.foldProjection";
import type { TopicModelData } from "./pipelines/topic-clustering-processing/projections/topicModel.foldProjection";
import { resolveSpanCommandShardCount } from "./pipelines/trace-processing/commands/spanCommandGroupKey";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "./pipelines/trace-processing/pipeline";
import { SpanAppendStore } from "./pipelines/trace-processing/projections/spanStorage.store";
import type { TraceAnalyticsData } from "./pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "./pipelines/trace-processing/projections/traceAnalytics.store";
import { TraceAnalyticsRollupAppendStore } from "./pipelines/trace-processing/projections/traceAnalyticsRollup.store";
import { TraceSummaryStore } from "./pipelines/trace-processing/projections/traceSummary.store";
import type { ResolveOriginCommandData } from "./pipelines/trace-processing/schemas/commands";
import type { TraceProcessingEvent } from "./pipelines/trace-processing/schemas/events";
import { createCustomEvaluationSyncHandler } from "./pipelines/trace-processing/subscribers/customEvaluationSync.subscriber";
import { createEvaluationTriggerSubscriber } from "./pipelines/trace-processing/subscribers/evaluationTrigger.subscriber";
import { createExperimentMetricsSyncHandler } from "./pipelines/trace-processing/subscribers/experimentMetricsSync.subscriber";
import {
  createDeferredOriginHandler,
  createOriginGateHandler,
  DEFERRED_CHECK_DELAY_MS,
  type DeferredOriginPayload,
  makeDeferredJobId,
} from "./pipelines/trace-processing/subscribers/originGate.subscriber";
import { createProjectMetadataHandler } from "./pipelines/trace-processing/subscribers/projectMetadata.subscriber";
import { createSimulationMetricsSyncHandler } from "./pipelines/trace-processing/subscribers/simulationMetricsSync.subscriber";
import { createSpanStorageBroadcastHandler } from "./pipelines/trace-processing/subscribers/spanStorageBroadcast.subscriber";
import { createTraceUpdateBroadcastHandler } from "./pipelines/trace-processing/subscribers/traceUpdateBroadcast.subscriber";
import { createTrackedEventSyncHandler } from "./pipelines/trace-processing/subscribers/trackedEventSync.subscriber";
import type { ProcessStore } from "./process-manager";
import type { FoldProjectionStore } from "./projections/foldProjection.types";
import type { AppendStore } from "./projections/mapProjection.types";
import { RedisCachedFoldStore } from "./projections/redisCachedFoldStore";
import { RepositoryFoldStore } from "./projections/repositoryFoldStore";
import type { StateProjectionStore } from "./projections/stateProjection.types";
import { BlobSweeper } from "./queues/groupQueue/blobSweeper";
import { throttledWindow } from "./subscribers/throttleWindow";
import {
  generateKillSwitchKey,
  type KillSwitchComponentType,
} from "./utils/killSwitch";

const logger = createLogger("langwatch:event-sourcing:pipeline-registry");

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
 * Late-bound holder for this pod's scenario execution pool. Owned by the
 * registry; the simulationRunExecution process manager's execute intent reads
 * it via `getPool`, and worker startup (startWorkers.bootScenarioProcessor)
 * sets the pool once the ScenarioExecutionPool exists — after the pipeline
 * registry has been built.
 */
export interface ScenarioExecutionPoolHolder {
  get(): ScenarioExecutionPool | null;
  set(pool: ScenarioExecutionPool): void;
}

function createScenarioExecutionPoolHolder(): ScenarioExecutionPoolHolder {
  let pool: ScenarioExecutionPool | null = null;
  return {
    get: () => pool,
    set: (p) => {
      pool = p;
    },
  };
}

/**
 * Pre-constructed repositories, resolved at the composition root (presets.ts).
 * The registry consumes these directly — no ClickHouse client resolution here.
 */
export interface PipelineRepositories {
  suiteRunState: SuiteRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  simulationRunState: SimulationRunStateRepository;
  /** Write side of the simulationRunMetrics map projection (migration 00078). */
  simulationRunMetricsStore: AppendStore<SimulationRunMetricsProjectionRecord>;
  /** Primary replica for read-after-write consistency. */
  experimentRunState: ExperimentRunStateRepository;
  /** Primary replica for read-after-write consistency. */
  traceSummaryFold: TraceSummaryRepository;
  canonicalLogStorage: CanonicalLogRecordRepository;
  /** ADR-056: the session-aggregate row + the (trace → session) map. */
  codingAgentSession: CodingAgentSessionRepository;
  codingAgentTraceSession: CodingAgentTraceSessionRepository;
  /** ADR-056 §5: converged per-series metric totals per session. */
  sessionMetricSeries: SessionMetricSeriesRepository;
  /** The per-call fact table: one row per session event (migration 00073). */
  codingAgentSessionEvents: CodingAgentSessionEventsRepository;
  metricDataPointStorage: MetricDataPointRepository;
  /** ADR-034 Phase 1: per-span rollup repository (app-side, replaces the MV). */
  traceAnalyticsRollup: TraceAnalyticsRollupRepository;
  /** ADR-034 Phase 2: slim per-trace analytics repository (dual-tap). */
  traceAnalytics: TraceAnalyticsRepository;
  /** ADR-034 Phase 6: per-evaluation rollup repository. */
  evaluationAnalyticsRollup: EvaluationAnalyticsRollupRepository;
  /** ADR-034 Phase 6: slim per-evaluation analytics repository. */
  evaluationAnalytics: EvaluationAnalyticsRepository;
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
  langyTurnAdmission: LangyTurnAdmissionRepository;
  /** Where the grants pipeline's write instructions land (ADR-110). */
  authzGrantsWrite: GrantProjectionWriteStore;
  /** Insert-only audit sink for the grants ledger (ADR-092 decision 17). */
  authzAuditTrail: AuthzAuditTrailStore;
  /** The identity pipeline's `Identifier` head + cursor (ADR-101 §3). */
  identityProjection: StateProjectionStore<IdentityFoldState>;
  /** Postgres reads the identity guards run against (ADR-101 §2). */
  identityHeads: IdentityHeadsRepository;
  /**
   * The `User` reads the same guards run against. The staged re-run has to
   * ask the cross-population collision question the calling path asked
   * (ADR-116 §6) — a guard that could only see the projection here would let
   * the queue state a fact the caller was refused.
   */
  identityUsers: IdentityUsersRepository;
  /**
   * The address lock the same guards claim before stating a fact (ADR-116
   * §6). The staged re-run arrives with the caller's own command id, so its
   * claim is the same claim rather than a second one.
   */
  identityReservations: IdentityReservationRepository;
  /** The two-step verification pipeline's `MfaEnrollment` head + cursor (D06). */
  mfaProjection: StateProjectionStore<MfaFoldState>;
  /** Postgres reads the two-step verification guards run against (D06). */
  mfaEnrollments: MfaEnrollmentRepository;
  /** The connection pipeline's `SsoConnection` head + cursor (D04). */
  ssoConnectionProjection: StateProjectionStore<SsoConnectionFoldState>;
  /** Postgres reads the connection guards run against (ADR-117 §5). */
  ssoConnectionReads: SsoConnectionReadRepository;
  /** Who a teardown would strand, read over the identity heads. */
  ssoConnectionStranding: SsoConnectionStrandingRepository;
  /** Activation's break-glass precondition (D05 hardens it). */
  ssoBreakGlassBindings: SsoBreakGlassBindingRepository;
  /** Whether an actor is a LangWatch platform operator — what makes deciding
   *  a domain claim and attesting a domain operator acts (D05 tier 1). */
  ssoPlatformOperators: SsoPlatformOperatorRepository;
  /** How the teardown grace wake dispatches its completion command. */
  ssoConnectionTeardown: ConnectionTeardownPort;
  /** The directory-sync pipeline's `ScimSyncState` head + cursor (D08). */
  scimSyncProjection: StateProjectionStore<ScimSyncFoldState>;
  /** Postgres reads the directory-sync guards run against (D08). */
  scimSyncReads: ScimSyncReadRepository;
  /** The join-request pipeline's `JoinRequest` head + cursor (D12). */
  joinRequestProjection: StateProjectionStore<JoinRequestFoldState>;
  /** Postgres reads the join-request guards run against (ADR-117, D12). */
  joinRequestReads: JoinRequestReadRepository;
  /** How the reminder and expiry wakes reach the world. */
  joinRequestLifecycle: JoinRequestLifecyclePort;
}

export interface PipelineRegistryDeps {
  eventSourcing: EventSourcing;
  repositories: PipelineRepositories;
  redis: Redis | Cluster;
  broadcast: BroadcastService;
  langy: {
    buffer: Pick<LangyTokenBuffer, "liveness" | "appendStatus" | "markError">;
    handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
    worker: Pick<LangyWorkerPort, "dispatch">;
    titleGenerator: LangyTitleGenerator;
  };
  topicClustering: {
    /** Runs one clustering page (the ADR-051 effect's domain function). */
    runPort: TopicClusteringRunPort;
  };
  enterprisePipelines: EnterprisePipelineSetConfig;
  projects: ProjectService;
  monitors: MonitorService;
  triggers: TriggerService;
  automations: { ports: AutomationDispatchPorts };
  prisma: PrismaClient;
  traces: {
    summary: TraceSummaryService;
    spans: SpanStorageService;
  };
  evaluations: {
    runs: EvaluationRunService;
    execution: EvaluationExecutionService;
  };
  organizations: OrganizationService;
  costRecorder: EvaluationCostRecorder;
  billingCheckpoints: BillingCheckpointService;
  usageReportingService?: UsageReportingService;
  gatewaySpend?: { repository: GatewaySpendEventsRepository };
  webhookDelivery?: WebhookDeliveryProcessDeps;
  gatewayDebits?: GatewayDebitsProcessDeps;
  /**
   * ADR-022: BlobStore for RecordSpanCommand spool reconstitution.
   * When provided, the trace-processing pipeline wires it into RecordSpanCommand
   * so oversized commands (> 256 KB) are fetched from S3 and the spool is
   * best-effort DELETEd after event_log INSERT succeeds.
   */
  blobStore?: BlobStore;
  governanceKpisSync?: GovernanceKpisSyncSubscriberDeps;
  governanceOcsfEventsSync?: GovernanceOcsfEventsSyncSubscriberDeps;
  retentionPolicyResolver?: RetentionPolicyResolver;
  codingAgent?: {
    /**
     * Maps a folded session's branch to its pull requests. Late-bound: the
     * mapping service is composed after the registry (it needs the GitHub
     * connection), so presets passes a `Deferred`'s callable proxy here.
     * Omitted where there is no GitHub connection to ask.
     */
    pullRequestMapping: PullRequestMappingSubscriberDeps;
  };
  /**
   * The fleet-wide GitHub linkage maintenance the scheduled process manager
   * drives. Late-bound for the same reason `codingAgent` is: the mapping
   * service and its repository are composed after the registry, so presets
   * passes `Deferred` callable proxies. Omitted where there is no GitHub
   * connection, in which case the pipeline is not registered at all.
   */
  github?: {
    /** One recheck pass; returns how many branches were re-asked about. */
    recheckDueBranches: () => Promise<number>;
    /** One retention pass over the branch bookkeeping. */
    pruneStaleBranchLinkage: () => Promise<{ branchChecks: number }>;
  };
}

/**
 * Composition root for all event-sourcing pipelines.
 *
 * Creates store adapters, builds subscribers and command classes, then registers
 * all pipelines with the EventSourcing runtime. Pipelines receive only
 * store interfaces and pre-built artifacts — never raw deps like prisma or ClickHouse clients.
 */
export class PipelineRegistry {
  constructor(private readonly deps: PipelineRegistryDeps) {}

  /**
   * ADR-051: the trace pipeline's projectMetadata subscriber bootstraps a
   * project's clustering schedule on its first real trace, but the topic
   * clustering pipeline (whose command it dispatches) registers later —
   * late-bound like the other cross-pipeline dispatchers.
   */
  private readonly bootstrapTopicClustering = new Deferred<
    (projectId: string) => Promise<void>
  >("bootstrapTopicClustering");

  private cached<State>(
    inner: FoldProjectionStore<State>,
    keyPrefix: string,
  ): FoldProjectionStore<State> {
    return new RedisCachedFoldStore<State>(inner, this.deps.redis as Redis, {
      keyPrefix,
    });
  }

  registerAll() {
    // TODO: The Customer.io simulation subscriber is implemented but not yet
    // registered — the counting strategy needs finalising (per-event
    // ClickHouse queries) before enabling. See
    // customerIoSimulationSync.subscriber.ts. Its trace and evaluation
    // siblings migrated with the reactor retirement (ADR-098) and are
    // likewise implemented but unregistered, pending that same decision.
    const traceSummaryStore = this.cached<TraceSummaryData>(
      new TraceSummaryStore(this.deps.repositories.traceSummaryFold),
      "trace_summaries",
    );

    const automationPorts = this.deps.automations.ports;
    const graphActivityHandler = createGraphTriggerActivityHandler({
      triggers: this.deps.triggers,
      evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
    });
    const automationPipeline = this.deps.eventSourcing.register(
      createAutomationsPipeline({
        dispatch: automationPorts.settlementDeps,
        sweep: {
          decideSweepCandidates: automationPorts.decideSweepCandidates,
          evaluateGraphTrigger: automationPorts.evaluateGraphTrigger,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
        prune: {
          pruneExpired: automationPorts.pruneWebhookDeliveries,
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
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
            this.deps.repositories.processStore.deleteDispatchedOutboxBatch(
              params,
            ),
          deleteDeadOutboxBatch: (params) =>
            this.deps.repositories.processStore.deleteDeadOutboxBatch(params),
          deleteConsumedInboxBatch: (params) =>
            this.deps.repositories.processStore.deleteConsumedInboxBatch(
              params,
            ),
        },
      }),
    );

    // Langy credential maintenance, on the same footing. The reaper existed and
    // was routed for cron, but the chart ships no CronJobs — so until now the
    // backstop for keys orphaned by a SIGKILLed manager had no caller at all.
    this.deps.eventSourcing.register(
      createLangyMaintenancePipeline({
        sessionKeyReap: {
          reap: () =>
            reapExpiredLangySessionApiKeys({ prisma: this.deps.prisma }),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    // Code agent credential maintenance, on the same footing. A sandbox key is
    // minted per run and nothing revokes it at the end of one, so this sweep
    // is what retires it.
    this.deps.eventSourcing.register(
      createAgentSandboxMaintenancePipeline({
        sandboxKeyReap: {
          reap: () =>
            reapExpiredAgentSandboxApiKeys({ prisma: this.deps.prisma }),
          deleteDispatchedBefore: (params) =>
            this.deps.repositories.processStore.deleteDispatchedBefore(params),
        },
      }),
    );

    // Pull-request linkage maintenance, on the same footing. It used to be a
    // `setTimeout` chain on every replica with no lock, so the fleet ran the
    // same cross-tenant scan N times every ten minutes.
    if (this.deps.github) {
      const github = this.deps.github;
      this.deps.eventSourcing.register(
        createGithubMaintenancePipeline({
          branchRecheck: {
            recheck: () => github.recheckDueBranches(),
            prune: () => github.pruneStaleBranchLinkage(),
            deleteDispatchedBefore: (params) =>
              this.deps.repositories.processStore.deleteDispatchedBefore(
                params,
              ),
          },
        }),
      );
    }

    const automationCommands = mapCommands(automationPipeline.commands);
    const evalPipeline = this.registerEvaluationPipeline({
      automations: {
        triggerMatchHandler: createEvaluationAlertTriggerMatchHandler({
          triggers: this.deps.triggers,
          traceSummaryStore,
          recordTriggerMatch: {
            send: automationCommands.recordTriggerMatch,
          },
        }),
        graphActivityHandler,
      },
    });
    // Registered BEFORE the metric, log and trace pipelines: their
    // coding-agent dispatch subscribers close over this pipeline's
    // contribution commands.
    const codingAgentPipeline = this.registerCodingAgentPipeline();
    if (this.deps.gatewaySpend) {
      this.registerGatewaySpendPipeline(this.deps.gatewaySpend);
      this.registerGovernanceEventsPipeline();
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
        }),
      ],
    });
    const {
      pipeline: tracePipeline,
      simComputeRunMetrics,
      wireExperimentDeps,
    } = this.registerTracePipeline({
      evalPipeline,
      traceSummaryStore,
      automations: {
        triggerMatchHandler: createTraceAlertTriggerMatchHandler({
          triggers: this.deps.triggers,
          recordTriggerMatch: {
            send: automationCommands.recordTriggerMatch,
          },
        }),
        graphActivityHandler,
      },
      codingAgentSubscribers: [
        createCodingAgentSpanFactsDispatchSubscriber({
          contributeSpanFacts: codingAgentCommands.contributeSpanFacts,
          getNormalizedSpanById: (params) =>
            this.deps.traces.spans.getNormalizedSpanById(params),
        }),
      ],
    });
    const suiteRunPipeline = this.registerSuiteRunPipeline();
    const { pipeline: simulationPipeline, scenarioExecutionPool } =
      this.registerSimulationPipeline({
        suiteRunPipeline,
        traceSummaryStore,
        simComputeRunMetrics,
      });

    const experimentRunPipeline = this.registerExperimentRunPipeline({
      wireExperimentDeps,
    });
    const { pipeline: langyConversationPipeline } =
      this.registerLangyConversationPipeline();
    const { pipeline: topicClusteringPipeline } =
      this.registerTopicClusteringPipeline();
    const enterprisePipelines = registerEnterprisePipelineSet({
      ...this.deps.enterprisePipelines,
      eventSourcing: this.deps.eventSourcing,
    });
    const billingPipeline = this.registerBillingReportingPipeline();
    // The grants ledger (ADR-092 §13). The write paths emit through the
    // app-layer ledger module, gated PER ORGANIZATION (decision 4): only an
    // organization whose genesis import has landed (its
    // SystemMigrationTenantState row, read by the engine gate) sends
    // these commands; every other organization still takes the imperative
    // Prisma path, and an operator's `rolled_back` flip returns one there
    // with no deploy.
    this.deps.eventSourcing.register(
      createAuthzGrantsPipeline({
        authzGrantsWriteStore: this.deps.repositories.authzGrantsWrite,
        authzAuditTrailStore: this.deps.repositories.authzAuditTrail,
      }),
    );
    // The identity pipeline (ADR-101, D01 PR 1). Ships dark: no production
    // writer dispatches these commands until the identity adapter lands, and
    // the adapter's per-user write gate itself ships closed until a user's
    // backfill (PR 2) latches — a deploy changes nothing on its own.
    this.deps.eventSourcing.register(
      createIdentityPipeline({
        identityProjectionStore: this.deps.repositories.identityProjection,
        identityGuards: new IdentityGuards(
          this.deps.repositories.identityHeads,
          this.deps.repositories.identityUsers,
          this.deps.repositories.identityReservations,
        ),
        // Two-step verification rides this same aggregate (D06), so its
        // commands share the per-person lane rather than racing it. Ships
        // dark: `MFA_ENROLLMENT_OPEN` defaults to `off`, so the two-factor
        // plugin is not registered and nothing dispatches these.
        mfaProjectionStore: this.deps.repositories.mfaProjection,
        mfaGuards: new MfaGuards(this.deps.repositories.mfaEnrollments),
      }),
    );
    // The SSO connection pipeline (ADR-117 §5, D04). Ships dark:
    // `SSOCONN_ROUTING` defaults to `off`, so nothing routes off its
    // projection and no `Organization.ssoDomain` write stops. Its only
    // production writer until D05 is the grandfather migration, which is
    // paced by per-organization enrollment like every other in-place
    // migration — a deploy changes nothing on its own.
    this.deps.eventSourcing.register(
      createSsoConnectionPipeline({
        connectionProjectionStore:
          this.deps.repositories.ssoConnectionProjection,
        connectionGuards: new SsoConnectionGuards({
          connections: this.deps.repositories.ssoConnectionReads,
          breakGlass: this.deps.repositories.ssoBreakGlassBindings,
          stranding: this.deps.repositories.ssoConnectionStranding,
          platformOperators: this.deps.repositories.ssoPlatformOperators,
        }),
        teardown: this.deps.repositories.ssoConnectionTeardown,
      }),
    );
    // The directory-sync pipeline (D08). Ships dark: `SCIM_V2_GRANTS`
    // defaults off, so no SCIM request path dispatches these commands and
    // the previous write path is unchanged — a deploy changes nothing on its
    // own. Its projection is what makes a failed apply visible with the
    // connection, the operation and a reason code, so it is registered
    // whether the flag is on or not: a history nobody writes to costs
    // nothing, and one that only exists once the flag flips would have no
    // past to show on the day it mattered.
    this.deps.eventSourcing.register(
      createScimSyncPipeline({
        scimSyncProjectionStore: this.deps.repositories.scimSyncProjection,
        scimSyncGuards: new ScimSyncGuards({
          syncs: this.deps.repositories.scimSyncReads,
        }),
      }),
    );

    // The join-request pipeline (ADR-117, D12). Ships dark: `JOIN_REQUESTS`
    // defaults off, so nothing dispatches a join command, no interstitial
    // renders and no admin panel appears — a deploy changes nothing on its
    // own, and rollback is the flag.
    this.deps.eventSourcing.register(
      createJoinRequestPipeline({
        joinRequestProjectionStore:
          this.deps.repositories.joinRequestProjection,
        joinRequestGuards: new JoinRequestGuards({
          requests: this.deps.repositories.joinRequestReads,
        }),
        lifecycle: this.deps.repositories.joinRequestLifecycle,
      }),
    );

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
      ...enterprisePipelines.commands,
      billing: mapCommands(billingPipeline.commands),
      automations: automationCommands,
      /** Late-bind the execution pool for the simulationRunExecution process manager. */
      scenarioExecutionPool,
    };
  }

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
        topicClusteringRunStatusStore:
          this.deps.repositories.topicClusteringRunStatus,
        topicClusteringRunHistoryStore:
          this.deps.repositories.topicClusteringRunHistory,
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
        },
      }),
    );

    const commands = mapCommands(pipeline.commands);
    outcomeCommands = {
      recordClusteringRunStarted: (args) =>
        commands.recordClusteringRunStarted(args),
      recordClusteringRunCompleted: (args) =>
        commands.recordClusteringRunCompleted(args),
      recordClusteringRunFailed: (args) =>
        commands.recordClusteringRunFailed(args),
    };
    // Level-triggered bootstrap: the projectMetadata subscriber asks on every
    // real ingest, and this claim keeps that to one commit per project per
    // window. See createRateLimitedBootstrap for why re-asking is safe.
    this.bootstrapTopicClustering.resolve(
      createRateLimitedBootstrap({
        redis: this.deps.redis,
        bootstrap: (projectId) =>
          commands.requestClustering({
            tenantId: projectId,
            occurredAt: Date.now(),
            trigger: "bootstrap",
          }),
      }),
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
        mintLangySessionApiKeyForUser({
          prisma: this.deps.prisma,
          userId,
          projectId,
          organizationId,
        }),
      revokeSessionKey: ({ apiKeyId, projectId }) =>
        revokeLangySessionApiKey({
          prisma: this.deps.prisma,
          apiKeyId,
          projectId,
        }).then(() => undefined),
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
        const projection = await conversationStore.load(conversationId, {
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
    const broadcastSubscriber =
      createLangyConversationUpdateBroadcastSubscriber({
        broadcast: this.deps.broadcast,
        conversations: conversationReader,
      });
    const admissionLifecycleSubscriber =
      createLangyTurnAdmissionLifecycleSubscriber({
        admissions: this.deps.repositories.langyTurnAdmission,
      });

    const pipeline = this.deps.eventSourcing.register(
      createLangyConversationProcessingPipeline({
        langyConversationProjectionStore: conversationStore,
        langyConversationTurnProjectionStore:
          this.deps.repositories.langyConversationTurnState,
        langyMessageProjectionStore: this.deps.repositories.langyMessageStorage,
        langyAnalyticsEventProjectionStore:
          this.deps.repositories.langyAnalyticsEventStorage,
        langyProcessPorts: effectPorts,
        subscribers: [
          livenessSubscriber,
          broadcastSubscriber,
          admissionLifecycleSubscriber,
        ],
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
    subscribers: Parameters<
      typeof createMetricProcessingPipeline
    >[0]["subscribers"];
  }) {
    const repository = this.deps.repositories.metricDataPointStorage;
    return this.deps.eventSourcing.register(
      createMetricProcessingPipeline({
        metricDataPointAppendStore: new MetricDataPointAppendStore(repository),
        metricSeriesCatalogAppendStore: new MetricSeriesCatalogAppendStore(
          repository,
        ),
        metricTimeRollupAppendStore: new MetricTimeRollupAppendStore(
          repository,
        ),
        metricCommandShardCount: resolveMetricCommandShardCount(
          process.env.METRIC_PROCESSING_SHARDS,
        ),
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
        webhookDelivery: this.deps.webhookDelivery,
      }),
    );
  }

  private registerGatewaySpendPipeline(deps: {
    repository: GatewaySpendEventsRepository;
  }) {
    return this.deps.eventSourcing.register(
      createGatewaySpendProcessingPipeline({
        gatewaySpendStore: this.cached<GatewaySpendState>(
          new GatewaySpendStore(deps.repository),
          "gateway_spend",
        ),
        // The ADR-073 delivery process manager consumes this pipeline's
        // committed events through its transactional inbox.
        webhookDelivery: this.deps.webhookDelivery,
        gatewayDebits: this.deps.gatewayDebits,
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

  private registerCodingAgentPipeline() {
    return this.deps.eventSourcing.register(
      createCodingAgentProcessingPipeline({
        // Read-through store (ADR-066): Redis is the warm read tier; on a miss
        // the store reads its own last committed state back from
        // coding_agent_sessions (store.get() → findBySessionId → decode row).
        // The delivery path never reads event_log. Same wiring as trace_summaries.
        codingAgentSessionStore: this.cached<CodingAgentSessionState>(
          new CodingAgentSessionStore(
            this.deps.repositories.codingAgentSession,
            {
              // The Sessions-destination stamp, inline at the commit seam with
              // its own per-process window — a read-model write, not a subscriber.
              onSessionsStored: createCodingAgentSessionSeenTouch({
                touchCodingAgentSessionSeen: (params) =>
                  this.deps.projects.touchCodingAgentSessionSeen(params),
              }),
            },
          ),
          "coding_agent_sessions",
        ),
        codingAgentTraceSessionAppendStore:
          new CodingAgentTraceSessionAppendStore(
            this.deps.repositories.codingAgentTraceSession,
          ),
        sessionMetricSeriesAppendStore: new SessionMetricSeriesAppendStore(
          this.deps.repositories.sessionMetricSeries,
        ),
        codingAgentSessionEventsAppendStore:
          new CodingAgentSessionEventsAppendStore(
            this.deps.repositories.codingAgentSessionEvents,
          ),
        sessionContextMemo: new RedisSessionContextMemo(this.deps.redis),
        ...(this.deps.codingAgent
          ? {
              pullRequestMappingHandler: createPullRequestMappingHandler(
                this.deps.codingAgent.pullRequestMapping,
              ),
            }
          : {}),
      }),
    );
  }

  private registerLogPipeline({
    subscribers,
  }: {
    subscribers: Parameters<
      typeof createLogProcessingPipeline
    >[0]["subscribers"];
  }) {
    return this.deps.eventSourcing.register(
      createLogProcessingPipeline({
        canonicalLogAppendStore: new CanonicalLogAppendStore(
          this.deps.repositories.canonicalLogStorage,
        ),
        logCommandShardCount: resolveCanonicalLogCommandShardCount(
          process.env.LOG_PROCESSING_SHARDS,
        ),
        subscribers,
      }),
    );
  }

  private registerEvaluationPipeline({
    automations,
  }: {
    automations: EvaluationProcessingPipelineDeps["automations"];
  }) {
    const executeEvaluationCommand = new ExecuteEvaluationCommand({
      monitors: this.deps.monitors,
      spanStorage: this.deps.traces.spans,
      traceEvents: this.deps.traces.spans,
      evaluationExecution: this.deps.evaluations.execution,
      costRecorder: this.deps.costRecorder,
      azureSafetyEnvResolver: getAzureSafetyEnvFromProject,
      // Emergency operator rollback for the langwatch#6397 settings recovery.
      // Without this line the flag is inert: the command defaults an absent
      // resolver to "not disabled", so /ops/feature-flags would report the
      // switch as available while flipping it changed nothing. The command
      // catches a rejection here and stays on the shipped default (recovery
      // ACTIVE) — an unreadable kill switch must not fail evaluations.
      isSettingsRecoveryDisabled: () =>
        featureFlagService.isEnabled(
          "ops_evaluator_settings_recovery_disabled",
          {
            distinctId: "evaluator-settings-recovery",
            defaultValue: false,
            // A pipeline-wide switch, flipped for the fleet and not per tenant.
            projectId: NOT_TARGETED,
            organizationId: NOT_TARGETED,
          },
        ),
      // ADR-040: offload oversized evaluator inputs to durable object storage
      // before the event is built. ON by default (this bounds the fat-payload
      // class behind the 2026-07-10 outage); the SYSTEM flag
      // ops_evaluation_payload_offload_disabled is the operator kill switch.
      // A flag-store error keeps the DEFAULT (offload runs): the kill switch
      // failing to read must not silently drop the protection. Storage errors
      // are handled INSIDE offloadInputsIfOversized, which degrades to a
      // bounded preview-only marker so the event stays lean even when S3 is
      // down. The catch below is the wiring-level fail-open for unexpected
      // errors only (service construction, serialization); there the inputs
      // stay inline and the unconditional repository belt-and-braces cap
      // keeps the ClickHouse row merge-safe.
      offloadInputs: async ({ projectId, evaluationId, inputs }) => {
        try {
          let disabled = false;
          try {
            disabled = await featureFlagService.isEnabled(
              "ops_evaluation_payload_offload_disabled",
              {
                distinctId: "evaluation-inputs-offload",
                defaultValue: false,
                // A pipeline-wide switch, flipped for the fleet.
                projectId: NOT_TARGETED,
                organizationId: NOT_TARGETED,
              },
            );
          } catch {
            // Unreadable kill switch: stay on the default (offload enabled).
          }
          if (disabled) return inputs;
          const { inputs: maybeOffloaded } = await offloadInputsIfOversized({
            inputs,
            projectId,
            evaluationId,
            storedObjects: createStoredObjectsService({ projectId }),
          });
          return maybeOffloaded;
        } catch (error) {
          createLogger("langwatch:evaluations:inputs-offload-fail-open").warn(
            {
              projectId,
              evaluationId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Evaluation inputs offload gate failed; keeping inputs inline (fail-open)",
          );
          return inputs;
        }
      },
    });

    return this.deps.eventSourcing.register(
      createEvaluationProcessingPipeline({
        evalRunStore: new EvaluationRunStore(
          this.deps.evaluations.runs.repository,
        ),
        // Redis cache is the eval slim fold's warm read path; a miss now falls
        // through to the store's own ClickHouse read-back (ADR-066, migration
        // 00056) rather than re-folding the event log. Same wiring as
        // trace_analytics.
        evaluationAnalyticsStore: this.cached<EvaluationAnalyticsData>(
          new EvaluationAnalyticsStore(
            this.deps.repositories.evaluationAnalytics,
          ),
          "evaluation_analytics",
        ),
        evaluationAnalyticsRollupAppendStore:
          new EvaluationAnalyticsRollupAppendStore(
            this.deps.repositories.evaluationAnalyticsRollup,
          ),
        executeEvaluationCommand,
        automations,
      }),
    );
  }

  private registerTracePipeline({
    evalPipeline,
    traceSummaryStore,
    automations,
    codingAgentSubscribers,
  }: {
    evalPipeline: ReturnType<PipelineRegistry["registerEvaluationPipeline"]>;
    traceSummaryStore: FoldProjectionStore<TraceSummaryData>;
    automations: TraceProcessingPipelineDeps["automations"];
    codingAgentSubscribers: TraceProcessingPipelineDeps["subscribers"];
  }) {
    const evalCommands = mapCommands(evalPipeline.commands);

    // Deferred dispatchers — resolved after pipeline registration.
    const resolveOrigin = new Deferred<
      CommandDispatcher<ResolveOriginCommandData>
    >("resolveOrigin");
    const scheduleDeferred = new Deferred<
      (payload: DeferredOriginPayload) => Promise<void>
    >("scheduleDeferred");
    const simComputeRunMetrics = new Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >("simComputeRunMetrics");

    const originGateHandler = createOriginGateHandler({
      scheduleDeferred: scheduleDeferred.fn,
    });

    const evaluationTrigger = createEvaluationTriggerSubscriber({
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

    // Without Redis, the worker-to-web pub/sub bridge is unavailable, so both
    // broadcast subscribers register inert.
    const broadcastDisabled = !this.deps.eventSourcing.redisConnection;

    const traceUpdateBroadcastHandler = createTraceUpdateBroadcastHandler({
      broadcast: this.deps.broadcast,
    });

    const spanStorageBroadcastHandler = createSpanStorageBroadcastHandler({
      broadcast: this.deps.broadcast,
    });

    const projectMetadataHandler = createProjectMetadataHandler({
      projects: this.deps.projects,
      bootstrapTopicClustering: (projectId) =>
        this.bootstrapTopicClustering.fn(projectId),
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
          logger.warn(
            "experiment computeExperimentRunMetrics not yet initialized, skipping",
          );
          return;
        }
        return expComputeRunMetrics(data);
      },
      lookupExperimentId: async (tenantId, runId) => {
        if (!expLookupExperimentId) {
          logger.warn(
            "experiment lookupExperimentId not yet initialized, skipping",
          );
          return null;
        }
        return expLookupExperimentId(tenantId, runId);
      },
    });

    // EE governance rollups, composed here as full subscriber specs so the
    // OSS pipeline definition stays free of `@ee` imports.
    const governanceKpisSync = this.deps.governanceKpisSync
      ? {
          fold: "traceSummary",
          when: isGovernanceKpiTrace,
          ...throttledWindow<TraceProcessingEvent>({
            makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
            windowMs: GOVERNANCE_KPIS_SYNC_WINDOW_MS,
          }),
          handler: createGovernanceKpisSyncHandler(
            this.deps.governanceKpisSync,
          ),
        }
      : undefined;

    const governanceOcsfEventsSync = this.deps.governanceOcsfEventsSync
      ? {
          fold: "traceSummary",
          when: isGovernanceOcsfTrace,
          ...throttledWindow<TraceProcessingEvent>({
            makeId: (event) => `${event.tenantId}:${event.aggregateId}`,
            windowMs: GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS,
          }),
          handler: createGovernanceOcsfEventsSyncHandler(
            this.deps.governanceOcsfEventsSync,
          ),
        }
      : undefined;

    const tracePipeline = this.deps.eventSourcing.register(
      createTraceProcessingPipeline({
        spanAppendStore: new SpanAppendStore(this.deps.traces.spans.repository),
        traceAnalyticsRollupAppendStore: new TraceAnalyticsRollupAppendStore(
          this.deps.repositories.traceAnalyticsRollup,
        ),
        // Redis cache is the slim fold's warm read path; a miss now falls
        // through to the store's own ClickHouse read-back (ADR-066, migration
        // 00056) rather than re-folding the event log. The wrapper still earns
        // its keep — it keeps the steady state off ClickHouse entirely.
        traceAnalyticsStore: this.cached<TraceAnalyticsData>(
          new TraceAnalyticsStore(this.deps.repositories.traceAnalytics),
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
        // ADR-022: Wire BlobStore so RecordSpanCommand can reconstitute
        // oversized commands and best-effort delete the transient S3 spool.
        blobStore: this.deps.blobStore,
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
    const deferredOriginQueue =
      tracePipeline.service.registerJob<DeferredOriginPayload>({
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

    // ADR-032 D5: register the standalone `datasetNormalize` GroupQueue job
    // (pure Postgres + S3, no fold/subscriber). Per-group concurrency is inherent
    // and the group key is the datasetId (framework prepends tenantId=projectId)
    // → exactly one normalize in flight per dataset. The enqueue side is wired
    // into the dataset domain via `registerDatasetNormalizeEnqueue`; when the
    // global queue is unavailable the dataset module inline-runs the handler.
    const datasetNormalizeHandler = createDatasetNormalizeHandler({
      repository: new DatasetRepository(this.deps.prisma),
      getStorage: getDatasetStorage,
    });
    const datasetNormalizeQueue =
      tracePipeline.service.registerJob<DatasetNormalizePayload>({
        name: "datasetNormalize",
        process: datasetNormalizeHandler,
        // The per-dataset group key already serializes to concurrency-1, so no
        // deduplication block is needed; the 200ms debounce default is
        // surprising and could swallow a fast retry (m1).
        groupKeyFn: (p) => p.datasetId,
      });

    if (datasetNormalizeQueue) {
      registerDatasetNormalizeEnqueue((payload) =>
        datasetNormalizeQueue.send(payload),
      );
    }
    // No else: when the global queue is absent the dataset module falls back to
    // running the handler inline at enqueue time (dev/test without a worker).

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
        lookupExperimentId: (
          tenantId: string,
          runId: string,
        ) => Promise<string | null>;
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
            this.deps.repositories.suiteRunState,
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
    simComputeRunMetrics: Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >;
  }) {
    const simulationRunStore = this.cached<SimulationRunStateData>(
      new SimulationRunStateFoldStore({
        repository: this.deps.repositories.simulationRunState,
        version: SIMULATION_PROJECTION_VERSIONS.RUN_STATE,
      }),
      "simulation_runs",
    );

    // Late-bound pool holder — worker startup sets the pool after the
    // pipeline is built; the process manager's execute intent reads it.
    const scenarioExecutionPool = createScenarioExecutionPoolHolder();

    const suiteRunCommands = mapCommands(suiteRunPipeline.commands);

    // Deferred dispatchers — resolved after pipeline registration.
    const selfComputeRunMetrics = new Deferred<
      CommandDispatcher<ComputeRunMetricsCommandData>
    >("selfComputeRunMetrics");
    const scheduleRetry = new Deferred<
      (payload: ComputeRunMetricsCommandData) => Promise<void>
    >("scheduleRetry");
    // The process manager's finish intent reports through this same
    // pipeline's commands, which exist only after `.build()`.
    const selfExecutionCommands = new Deferred<
      () => SimulationRunExecutionCommands
    >("selfExecutionCommands");

    const traceReadDerivation = new TraceReadDerivationService(
      this.deps.traces.spans,
    );
    const computeRunMetricsCommand = new ComputeRunMetricsCommand({
      traceSummaryStore,
      scheduleRetry: scheduleRetry.fn,
      deriveScenarioRoleMetrics: (params) =>
        traceReadDerivation.deriveScenarioRoleMetrics(params),
    });

    // ECST backfill: FinishRunCommand loads the run's prior events straight
    // from the canonical event store (aggregateType "simulation_run").
    const finishRunCommand = new FinishRunCommand({
      loadPriorEvents: async ({ tenantId, scenarioRunId }) => {
        const eventStore =
          this.deps.eventSourcing.getEventStore<SimulationProcessingEvent>();
        if (!eventStore) return [];
        return eventStore.getEvents(
          scenarioRunId,
          { tenantId: createTenantId(tenantId) },
          "simulation_run",
        );
      },
    });

    const simulationPipeline = this.deps.eventSourcing.register(
      createSimulationProcessingPipeline({
        simulationRunStore,
        simulationRunMetricsStore:
          this.deps.repositories.simulationRunMetricsStore,
        finishRunCommand,
        computeRunMetricsCommand,
        simulationRunExecution: {
          getPool: () => scenarioExecutionPool.get(),
          publishCancellation: async ({ projectId, scenarioRunId }) => {
            const publisher = this.deps.eventSourcing.redisConnection ?? null;
            if (!publisher) {
              logger.warn(
                { scenarioRunId },
                "No Redis publisher available, cancellation broadcast skipped",
              );
              return;
            }
            await publishCancellation({
              publisher,
              message: { projectId, scenarioRunId },
            });
          },
          commands: selfExecutionCommands.fn,
        },
        snapshotUpdateBroadcast: {
          broadcast: this.deps.broadcast,
          hasRedis: !!this.deps.eventSourcing.redisConnection,
        },
        suiteRunSync: {
          recordSuiteRunItemStarted: suiteRunCommands.recordSuiteRunItemStarted,
          completeSuiteRunItem: suiteRunCommands.completeSuiteRunItem,
        },
        traceMetricsSync: {
          computeRunMetrics: selfComputeRunMetrics.fn,
        },
      }),
    );

    // Resolve self-referencing command
    const simCommands = mapCommands(simulationPipeline.commands);
    selfComputeRunMetrics.resolve(simCommands.computeRunMetrics);
    selfExecutionCommands.resolve(() => simCommands);

    // Resolve cross-pipeline deferred (trace → simulation)
    simComputeRunMetrics.resolve(simCommands.computeRunMetrics);

    // Resolve deferred retry job
    const retryJobId = (payload: ComputeRunMetricsCommandData) =>
      `compute-metrics-retry:${payload.tenantId}:${payload.scenarioRunId}:${payload.traceId}`;

    const retryQueue =
      simulationPipeline.service.registerJob<ComputeRunMetricsCommandData>({
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

    return { pipeline: simulationPipeline, scenarioExecutionPool };
  }

  private registerBillingReportingPipeline() {
    const reportUsageForMonthCommand = new ReportUsageForMonthCommand({
      organizations: this.deps.organizations,
      billingCheckpoints: this.deps.billingCheckpoints,
      getUsageReportingService: () => this.deps.usageReportingService,
      queryBillableEventsTotal,
      selfDispatch: (data) => {
        const pipeline = this.deps.eventSourcing.getPipeline(
          BILLING_REPORTING_PIPELINE_NAME,
        );
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
    wireExperimentDeps: ReturnType<
      PipelineRegistry["registerTracePipeline"]
    >["wireExperimentDeps"];
  }) {
    const experimentRunStore = this.cached<ExperimentRunStateData>(
      createExperimentRunStateFoldStore(
        this.deps.repositories.experimentRunState,
      ),
      "experiment_runs",
    );

    const experimentRunPipeline = this.deps.eventSourcing.register(
      createExperimentRunProcessingPipeline({
        experimentRunStateFoldStore: experimentRunStore,
        experimentRunItemAppendStore:
          this.deps.repositories.experimentRunItemStorage,
      }),
    );

    // Wire the trace-side experimentMetricsSync subscriber's late-bound deps
    const expCommands = mapCommands(experimentRunPipeline.commands);

    // The experimentId lookup, pre-built at the composition root (presets.ts)
    // over the App's ClickHouse resolver — the registry consumes it directly,
    // it does not resolve a client itself (see PipelineRepositories above).
    const lookupExperimentId = async (
      tenantId: string,
      runId: string,
    ): Promise<string | null> => {
      try {
        return await this.deps.repositories.experimentIdLookup.findExperimentId(
          { tenantId, runId },
        );
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

import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { getApp } from "../app-layer/app";
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

function getDefinitions(): ReadonlyArray<
  StaticPipelineDefinition<any, any, any>
> {
  return getApp().eventSourcing?.definitions ?? [];
}

export function getProjectionMetadata(): ProjectionMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    const folds = Array.from(def.foldProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        pauseKey: `${pipelineName}/projection/${definition.name}`,
        kind: "fold" as const,
      }),
    );
    const maps = Array.from(def.mapProjections.values()).map(
      ({ definition }) => ({
        projectionName: definition.name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // Maps run as `__jobType=handler` in the GroupQueue, so the pause-set
        // entry must use the `handler` segment to match the dispatcher's Lua check.
        pauseKey: `${pipelineName}/handler/${definition.name}`,
        kind: "map" as const,
      }),
    );
    const states = Array.from(def.stateProjections?.entries() ?? []).map(
      ([name]) => ({
        projectionName: name,
        pipelineName,
        aggregateType,
        source: "pipeline" as const,
        // State projections enqueue with `__jobType=stateProjection`; the
        // dispatcher matches the pause key against that raw segment.
        pauseKey: `${pipelineName}/stateProjection/${name}`,
        kind: "state" as const,
      }),
    );
    return [...folds, ...maps, ...states];
  });
}

export function getSubscriberMetadata(): SubscriberMetadata[] {
  return getDefinitions().flatMap((def) => {
    const { name: pipelineName, aggregateType } = def.metadata;
    return Array.from(def.foldSubscribers.values()).map(
      ({ projectionName, definition }) => ({
        subscriberName: definition.name,
        pipelineName,
        aggregateType,
        afterProjection: projectionName,
      }),
    );
  });
}

/**
 * Event subscribers registered on each pipeline — live consumers of committed
 * events that carry no projection state. This is the DejaView-facing view of
 * the `.withEventSubscriber` / `.withSubscriber({ events })` seam; the
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

/**
 * One descriptor per ES kill-switch key that the registered pipelines
 * will generate at runtime. Used by the Ops Feature Flags page to list
 * every togglable kill switch, even ones that have no postgres row yet.
 *
 * Names follow `es-<aggregate>-<componentType>-<componentName>-killswitch`
 * (see src/server/event-sourcing/utils/killSwitch.ts).
 */
export interface KillSwitchDescriptor {
  key: string;
  aggregateType: string;
  componentType: KillSwitchComponentType;
  componentName: string;
  pipelineName: string;
}

export function getKillSwitchDescriptors(): KillSwitchDescriptor[] {
  return getDefinitions().flatMap(killSwitchDescriptorsOf);
}

function killSwitchDescriptorsOf(
  def: StaticPipelineDefinition<any, any, any>,
): KillSwitchDescriptor[] {
  const out: KillSwitchDescriptor[] = [];
  const { name: pipelineName, aggregateType } = def.metadata;
  for (const { definition } of def.foldProjections.values()) {
    out.push({
      key: `es-${aggregateType}-projection-${definition.name}-killswitch`,
      aggregateType,
      componentType: "projection",
      componentName: definition.name,
      pipelineName,
    });
  }
  for (const { definition } of def.mapProjections.values()) {
    out.push({
      key: `es-${aggregateType}-mapProjection-${definition.name}-killswitch`,
      aggregateType,
      componentType: "mapProjection",
      componentName: definition.name,
      pipelineName,
    });
  }
  // State projections check `componentType: "projection"` at runtime (the
  // router reuses the fold-shaped key), so the descriptor must match it —
  // a "stateProjection" segment here would list a switch nothing reads.
  // Same for a custom key: emit the one the router consults.
  for (const [name, definition] of def.stateProjections?.entries() ?? []) {
    out.push({
      key:
        definition.options?.killSwitch?.customKey ??
        generateKillSwitchKey(aggregateType, "projection", name),
      aggregateType,
      componentType: "projection",
      componentName: name,
      pipelineName,
    });
  }
  for (const cmd of def.commands) {
    out.push({
      key: `es-${aggregateType}-command-${cmd.name}-killswitch`,
      aggregateType,
      componentType: "command",
      componentName: cmd.name,
      pipelineName,
    });
  }
  // Subscribers belong here MORE than the others do, not less: the enqueue
  // seam decides relevance and DISCARDS what it judges irrelevant, and
  // subscriber fan-out is never replayed (ADR-069), so a bad filter loses
  // those events for good. `ops.setFeatureFlag` rejects any key that is
  // neither a registry entry nor a live descriptor, so a switch missing from
  // this list is not merely unlisted — it is unsettable, leaving a revert as
  // the only way to stop the seam it guards.
  //
  // A subscriber may override its key via `options.killSwitch.customKey`;
  // emit the key the router will actually read, or the page would offer one
  // nothing consults.
  for (const definition of def.eventSubscribers.values()) {
    out.push({
      // Generated, never re-spelled: the comment above is the reason. A
      // hand-built key that drifts from `generateKillSwitchKey` is not a
      // cosmetic mismatch — `ops.setFeatureFlag` refuses a key that is
      // neither a registry entry nor a live descriptor, so the switch
      // becomes unsettable.
      key:
        definition.options?.killSwitch?.customKey ??
        generateKillSwitchKey(aggregateType, "subscriber", definition.name),
      aggregateType,
      componentType: "subscriber",
      componentName: definition.name,
      pipelineName,
    });
  }
  return out;
}

export function getDejaViewProjections(): DejaViewProjection[] {
  return getDefinitions().flatMap((def) =>
    Array.from(def.foldProjections.values()).map(({ definition: d }) => ({
      projectionName: d.name,
      eventTypes: d.eventTypes,
      init: () => d.init(),
      apply: (state: unknown, event: { type: string }) =>
        d.apply(state, event as any),
    })),
  );
}
