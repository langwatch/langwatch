import type { AutomationApi } from "@langwatch/automation-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { EventingParticipation } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  TraceCapabilityUnavailableError,
  type TraceCanonicalisationService,
  type TraceSummaryData,
} from "@langwatch/trace-contract";

import type {
  TraceProcessingPipelineDefinition,
  TraceSpanCostEnrichment,
  TraceSpanTokenEstimation,
} from "../app/trace.members.ts";
import type { TraceTokenCounter } from "../channels/token-counter.channel.ts";
import type { TraceTenantBroadcast } from "../channels/trace-tenant-broadcast.channel.ts";
import { createCodingAgentSpanFactsDispatchSubscriber } from "../eventing/coding-agent-span-facts-dispatch.subscriber.ts";
import { createCustomEvaluationSyncHandler } from "../eventing/custom-evaluation-sync.subscriber.ts";
import { createDeferredOriginHandler } from "../eventing/deferred-origin.process.ts";
import { createEvaluationTriggerSubscriber } from "../eventing/evaluation-trigger.subscriber.ts";
import { createExperimentMetricsSyncHandler } from "../eventing/experiment-metrics-sync.subscriber.ts";
import { passesTraceOriginGuards } from "../eventing/origin-guarded.subscriber.ts";
import { createProjectMetadataHandler } from "../eventing/project-metadata.subscriber.ts";
import { EventingRecordSpanAdapter } from "../eventing/record-span.commands.ts";
import { createSimulationMetricsSyncHandler } from "../eventing/simulation-metrics-sync.subscriber.ts";
import { createSpanStorageBroadcastHandler } from "../eventing/span-storage-broadcast.subscriber.ts";
import { SpanStorageStore } from "../eventing/span-storage.store.ts";
import { TraceAnalyticsStore } from "../eventing/trace-derived.store.ts";
import { createTraceProcessingProducerPipeline } from "../eventing/trace-processing-producer.pipeline.ts";
import { EventingTracePipelineAdapter } from "../eventing/trace-processing-projections.pipeline.ts";
import { buildTraceProcessingConsumer } from "../eventing/trace-processing.pipeline.ts";
import { TraceAnalyticsRollupStore } from "../eventing/trace-rollup.store.ts";
import { TraceSummaryStore } from "../eventing/trace-summary.store.ts";
import { createTraceUpdateBroadcastHandler } from "../eventing/trace-update-broadcast.subscriber.ts";
import {
  type TrackedEventSyncSubscriberDeps,
  createTrackedEventSyncHandler,
} from "../eventing/tracked-event-sync.subscriber.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { leanForProjection } from "../rules/trace-projection-lean.rules.ts";
import { OtlpSpanCostEnrichmentService } from "./span-cost-enrichment.service.ts";
import { OtlpSpanTokenEstimationService } from "./span-token-estimation.service.ts";
import { TraceEvaluationLoopMetricsService } from "./trace-evaluation-loop-metrics.service.ts";
import { TraceIoExtractionAdapterService } from "./trace-io-extraction-adapter.service.ts";
import { TraceMediaReferenceService } from "./trace-media-reference.service.ts";
import { TraceModelCostService } from "./trace-model-cost.service.ts";
import type { TraceProcessingCommandsService } from "./trace-processing-commands.service.ts";
import { TraceSpanNormalizationAdapterService } from "./trace-span-normalization-adapter.service.ts";

export interface TraceProcessingPeers {
  codingAgents: Pick<CodingAgentApi, "contributeReceivedSpan">;
  dataPrivacy: Pick<DataPrivacyApi, "redactSpan" | "dropSpanContent">;
  dataRetention: Pick<
    DataRetentionApi,
    "getPlatformDefaultRetentionDays" | "getResolvedForProject"
  >;
  automations: Pick<
    AutomationApi,
    "handleTraceTriggerMatch" | "handleEvaluationGraphTriggerActivity"
  >;
  evaluations: Pick<
    EvaluationApi,
    "queueTraceEvaluation" | "reportEvaluation" | "deriveEvaluatorId"
  >;
  experiments: Pick<ExperimentApi, "computeRunMetrics" | "lookupExperimentId">;
  featureFlags: FeatureFlagApi;
  modelProviders: Pick<ModelProviderApi, "listCosts">;
  monitors: Pick<MonitorApi, "getEnabledOnMessageMonitors">;
  projects: Pick<ProjectApi, "findById" | "updateMetadata" | "resolveOrgAdmin">;
  scenarios: Pick<ScenarioApi, "computeRunMetrics">;
  topics: Pick<TopicApi, "bootstrapClustering">;
}

export interface TraceProcessingPipelineInput {
  processName: string;
  tokenizer: TraceTokenCounter;
  peers: TraceProcessingPeers;
  repositories: Pick<
    TraceRepositories,
    "spanStorage" | "summaryProjection" | "analyticsProjection" | "analyticsRollup"
  >;
  canonicalisation: TraceCanonicalisationService;
  commands: TraceProcessingCommandsService;
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  recordTrackedEvent: TrackedEventSyncSubscriberDeps["recordTrackedEvent"];
  /** Tells a tenant's open tabs a trace moved; presence relays it in the serving process. */
  broadcast: TraceTenantBroadcast;
}

/** trace_processing per role: producers send; consumers fold and react as main's worker did. */
export class TraceProcessingPipelineService {
  static create(input: TraceProcessingPipelineInput): TraceProcessingPipelineService {
    return new TraceProcessingPipelineService(input);
  }

  private constructor(private readonly input: TraceProcessingPipelineInput) {}

  build(setup: { participation: EventingParticipation }): TraceProcessingPipelineDefinition {
    if (setup.participation !== "consume") {
      return createTraceProcessingProducerPipeline({
        processName: this.input.processName,
      });
    }
    return buildTraceProcessingConsumer(this.#projections(), this.#reactions());
  }

  #refuse(capability: string): TraceCapabilityUnavailableError {
    return new TraceCapabilityUnavailableError(this.input.processName, capability);
  }

  #projections(): ReturnType<EventingTracePipelineAdapter["build"]> {
    const { peers, repositories, canonicalisation } = this.input;
    const defaultRetentionDays = (): number =>
      peers.dataRetention.getPlatformDefaultRetentionDays();
    return EventingTracePipelineAdapter.create({
      spanStore: SpanStorageStore.create({
        storage: repositories.spanStorage,
        defaultRetentionDays,
      }),
      summaryStore: TraceSummaryStore.create({
        storage: repositories.summaryProjection,
        defaultRetentionDays,
      }),
      derivedStore: TraceAnalyticsStore.create({
        storage: repositories.analyticsProjection,
        defaultRetentionDays,
      }),
      rollupStore: TraceAnalyticsRollupStore.create({
        storage: repositories.analyticsRollup,
        defaultRetentionDays,
      }),
      canonicalisation,
      ioExtraction: TraceIoExtractionAdapterService.create(canonicalisation),
      mediaReferences: TraceMediaReferenceService.create(),
      modelCosts: TraceModelCostService.create(),
      spanNormalization: TraceSpanNormalizationAdapterService.create(canonicalisation),
      prepareEventForProjection: (event) => leanForProjection(event),
      recordSpanCommand: EventingRecordSpanAdapter.create({
        piiRedaction: {
          redact: (input) => peers.dataPrivacy.redactSpan(input),
        },
        contentDrop: {
          drop: (span, projectId) => peers.dataPrivacy.dropSpanContent({ span, projectId }),
        },
        costEnrichment: this.#costEnrichment(),
        tokenEstimation: this.#tokenEstimation(),
      }),
    })
      .build()
      .withRetention({
        resolve: (tenantId) => peers.dataRetention.getResolvedForProject({ projectId: tenantId }),
      });
  }

  #tokenEstimation(): TraceSpanTokenEstimation {
    const estimation = OtlpSpanTokenEstimationService.create({
      tokenizer: this.input.tokenizer,
      featureFlags: this.input.peers.featureFlags,
    });
    return { estimate: (span, tenantId) => estimation.estimateSpanTokens({ span, tenantId }) };
  }

  #costEnrichment(): TraceSpanCostEnrichment {
    const enrichment = OtlpSpanCostEnrichmentService.create({
      modelCosts: {
        listCosts: (listInput) => this.input.peers.modelProviders.listCosts(listInput),
      },
    });
    return { enrich: (span, tenantId) => enrichment.enrichSpan({ span, tenantId }) };
  }

  #reactions(): Parameters<typeof buildTraceProcessingConsumer>[1] {
    const { peers, commands } = this.input;
    const normalization = TraceSpanNormalizationAdapterService.create(this.input.canonicalisation);
    const resolveOrigin = createDeferredOriginHandler((data) => commands.resolveOrigin(data));
    return {
      resolveDeferredOrigin: async ({ tenantId, traceId }) => {
        const summary = await this.input.findSummary({ projectId: tenantId, traceId });
        if (summary?.attributes["langwatch.origin"]) return;
        await resolveOrigin({ id: traceId, tenantId, traceId });
      },
      evaluationTrigger: createEvaluationTriggerSubscriber({
        featureFlags: peers.featureFlags,
        monitors: peers.monitors,
        evaluation: { send: (data) => peers.evaluations.queueTraceEvaluation(data) },
        metrics: TraceEvaluationLoopMetricsService.create(),
      }),
      customEvaluationSync: createCustomEvaluationSyncHandler({
        reportEvaluation: (data) => peers.evaluations.reportEvaluation(data),
        deriveEvaluatorId: (name) => peers.evaluations.deriveEvaluatorId(name),
      }),
      trackedEventSync: createTrackedEventSyncHandler({
        recordTrackedEvent: this.input.recordTrackedEvent,
      }),
      traceUpdateBroadcast: createTraceUpdateBroadcastHandler({ broadcast: this.input.broadcast }),
      projectMetadata: createProjectMetadataHandler({
        projects: peers.projects,
        bootstrapTopicClustering: (projectId) => peers.topics.bootstrapClustering({ projectId }),
        recordProductEvent: () => {
          throw this.#refuse("the product analytics sink");
        },
      }),
      simulationMetricsSync: createSimulationMetricsSyncHandler({
        computeRunMetrics: (data) => peers.scenarios.computeRunMetrics(data),
      }),
      experimentMetricsSync: createExperimentMetricsSyncHandler({
        computeExperimentRunMetrics: (data) => peers.experiments.computeRunMetrics(data),
        lookupExperimentId: async (tenantId, runId) => {
          const found = await peers.experiments.lookupExperimentId({ tenantId, runId });
          return found.kind === "recorded" ? found.experimentId : null;
        },
      }),
      triggerMatch: async (event, context) => {
        if (!passesTraceOriginGuards(event, context.state)) return;
        await peers.automations.handleTraceTriggerMatch({
          event: { occurredAt: event.occurredAt },
          context: { tenantId: String(context.tenantId), aggregateId: context.aggregateId },
        });
      },
      graphTriggerActivity: (event, context) =>
        peers.automations.handleEvaluationGraphTriggerActivity({
          event: { occurredAt: event.occurredAt },
          context: { tenantId: String(context.tenantId) },
        }),
      codingAgentSpanFactsDispatch: createCodingAgentSpanFactsDispatchSubscriber({
        normalize: (event) =>
          normalization.normalizeSpanReceived({
            tenantId: String(event.tenantId),
            span: event.data.span,
            resource: event.data.resource,
            instrumentationScope: event.data.instrumentationScope,
          }),
        contributeReceivedSpan: (input) => peers.codingAgents.contributeReceivedSpan(input),
      }),
      spanStorageBroadcast: createSpanStorageBroadcastHandler({ broadcast: this.input.broadcast }),
      broadcastDisabled: false,
    };
  }
}
