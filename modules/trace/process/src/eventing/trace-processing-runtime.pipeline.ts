import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EventingParticipation } from "@langwatch/eventing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceCanonicalisationService, TraceSummaryData } from "@langwatch/trace-contract";

import type {
  TraceProcessingPipelineDefinition,
  TraceSpanCostEnrichment,
  TraceSpanTokenEstimation,
} from "../app/trace.members.ts";
import type { TraceTokenCounter } from "../channels/token-counter.channel.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { leanForProjection } from "../rules/trace-projection-lean.rules.ts";
import { OtlpSpanCostEnrichmentService } from "../services/span-cost-enrichment.service.ts";
import { OtlpSpanTokenEstimationService } from "../services/span-token-estimation.service.ts";
import { TraceEvaluationLoopMetricsService } from "../services/trace-evaluation-loop-metrics.service.ts";
import { TraceIoExtractionAdapterService } from "../services/trace-io-extraction-adapter.service.ts";
import { TraceMediaReferenceService } from "../services/trace-media-reference.service.ts";
import { TraceModelCostService } from "../services/trace-model-cost.service.ts";
import type { TraceProcessingCommandsService } from "../services/trace-processing-commands.service.ts";
import { TraceSpanNormalizationAdapterService } from "../services/trace-span-normalization-adapter.service.ts";
import { createCodingAgentSpanFactsDispatchSubscriber } from "./coding-agent-span-facts-dispatch.subscriber.ts";
import { createCustomEvaluationSyncHandler } from "./custom-evaluation-sync.subscriber.ts";
import { createDeferredOriginHandler } from "./deferred-origin.process.ts";
import { createEvaluationTriggerSubscriber } from "./evaluation-trigger.subscriber.ts";
import { createExperimentMetricsSyncHandler } from "./experiment-metrics-sync.subscriber.ts";
import {
  createProjectMetadataHandler,
  type ProjectMetadataSubscriberDeps,
} from "./project-metadata.subscriber.ts";
import { EventingRecordSpanAdapter } from "./record-span.commands.ts";
import { createSpanStorageBroadcastHandler } from "./span-storage-broadcast.subscriber.ts";
import { SpanStorageStore } from "./span-storage.store.ts";
import { TraceAnalyticsStore } from "./trace-derived.store.ts";
import { createTraceProcessingProducerPipeline } from "./trace-processing-producer.pipeline.ts";
import { EventingTracePipelineAdapter } from "./trace-processing-projections.pipeline.ts";
import { buildTraceProcessingConsumer } from "./trace-processing.pipeline.ts";
import { TraceAnalyticsRollupStore } from "./trace-rollup.store.ts";
import { TraceSummaryStore } from "./trace-summary.store.ts";
import { createTraceUpdateBroadcastHandler } from "./trace-update-broadcast.subscriber.ts";
import {
  type TrackedEventSyncSubscriberDeps,
  createTrackedEventSyncHandler,
} from "./tracked-event-sync.subscriber.ts";

interface TraceProcessingPeers {
  codingAgents: Pick<CodingAgentApi, "contributeReceivedSpan">;
  dataPrivacy: Pick<DataPrivacyApi, "redactSpan" | "dropSpanContent">;
  dataRetention: Pick<
    DataRetentionApi,
    "getPlatformDefaultRetentionDays" | "getResolvedForProject"
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
  topics: Pick<TopicApi, "bootstrapClustering">;
}

export interface TraceProcessingPipelineInput {
  role: string;
  tokenizer: TraceTokenCounter;
  peers: TraceProcessingPeers;
  repositories: Pick<
    TraceRepositories,
    | "spanStorage"
    | "summaryProjection"
    | "analyticsProjection"
    | "analyticsRollup"
    | "summaryFoldCache"
    | "analyticsFoldCache"
  >;
  canonicalisation: TraceCanonicalisationService;
  commands: TraceProcessingCommandsService;
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  recordTrackedEvent: TrackedEventSyncSubscriberDeps["recordTrackedEvent"];
  /** Tells a tenant's open tabs a trace moved; presence relays it in the serving process. */
  broadcast: Pick<PresenceApi, "publishProjectEvent">;
  /** Where a project's first and later traces are recorded as trace's own events. */
  milestones: ProjectMetadataSubscriberDeps["milestones"];
}

/** trace_processing per role: producers send; consumers fold and react as main's worker did. */
export class TraceProcessingRuntimeAdapter {
  static create(input: TraceProcessingPipelineInput): TraceProcessingRuntimeAdapter {
    return new TraceProcessingRuntimeAdapter(input);
  }

  private constructor(private readonly input: TraceProcessingPipelineInput) {}

  build(setup: { participation: EventingParticipation }): TraceProcessingPipelineDefinition {
    if (setup.participation === "produce") {
      return createTraceProcessingProducerPipeline({
        role: this.input.role,
      });
    }
    return buildTraceProcessingConsumer(this.#projections(), this.#reactions());
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
      summaryStore: repositories.summaryFoldCache.cached(
        TraceSummaryStore.create({ storage: repositories.summaryProjection, defaultRetentionDays }),
      ),
      derivedStore: repositories.analyticsFoldCache.cached(
        TraceAnalyticsStore.create({
          storage: repositories.analyticsProjection,
          defaultRetentionDays,
        }),
      ),
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
        milestones: this.input.milestones,
      }),
      experimentMetricsSync: createExperimentMetricsSyncHandler({
        computeExperimentRunMetrics: (data) => peers.experiments.computeRunMetrics(data),
        lookupExperimentId: async (tenantId, runId) => {
          const found = await peers.experiments.lookupExperimentId({ tenantId, runId });
          return found.kind === "recorded" ? found.experimentId : null;
        },
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
