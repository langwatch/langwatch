import type { AutomationApi } from "@langwatch/automation-contract";
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
} from "../app/trace.members.ts";
import { CustomEvaluationSync } from "../eventing/custom-evaluation-sync.subscriber.ts";
import { createEvaluationTriggerSubscriber } from "../eventing/evaluation-trigger.subscriber.ts";
import { createExperimentMetricsSyncHandler } from "../eventing/experiment-metrics-sync.subscriber.ts";
import { passesTraceOriginGuards } from "../eventing/origin-guarded.subscriber.ts";
import { ProjectMetadataSync } from "../eventing/project-metadata.subscriber.ts";
import { createSimulationMetricsSyncHandler } from "../eventing/simulation-metrics-sync.subscriber.ts";
import { SpanStorageStore } from "../eventing/span-storage.store.ts";
import { TraceAnalyticsStore } from "../eventing/trace-derived.store.ts";
import { buildTraceProcessingConsumer } from "../eventing/trace-processing.pipeline.ts";
import { TraceAnalyticsRollupStore } from "../eventing/trace-rollup.store.ts";
import { TraceSummaryStore } from "../eventing/trace-summary.store.ts";
import {
  TrackedEventSync,
  type TrackedEventSyncSubscriberDeps,
} from "../eventing/tracked-event-sync.subscriber.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import { TraceDeferredOriginEventingAdapter } from "./eventing.deferred-origin.service.ts";
import { EventingRecordSpanAdapter } from "./eventing.record-span.service.ts";
import { EventingTracePipelineAdapter } from "./eventing.trace-pipeline.service.ts";
import { ModelCatalogTraceModelCostAdapter } from "./model-catalog.trace-model-cost.service.ts";
import { OtelTraceEvaluationLoopMetricsAdapter } from "./otel.trace-evaluation-loop-metrics.service.ts";
import { TraceProjectionLeanService } from "./projection/trace-projection-lean.service.ts";
import { OtlpSpanCostEnrichmentService } from "./span-cost-enrichment.service.ts";
import { TraceIoExtractionAdapter } from "./trace-io-extraction-adapter.service.ts";
import { TraceMediaReferenceAdapter } from "./trace-media-reference.service.ts";
import type { TraceProcessingCommandsService } from "./trace-processing-commands.service.ts";
import { TraceProcessingProducerAdapter } from "./trace-processing-producer.service.ts";
import { TraceSpanNormalizationAdapter } from "./trace-span-normalization-adapter.service.ts";

export interface TraceProcessingPeers {
  dataPrivacy: Pick<DataPrivacyApi, "redactSpan" | "dropSpanContent">;
  dataRetention: Pick<DataRetentionApi, "getPlatformDefaultRetentionDays">;
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
  peers: TraceProcessingPeers;
  repositories: Pick<
    TraceRepositories,
    "spanStorage" | "summaryProjection" | "analyticsProjection" | "analyticsRollup"
  >;
  canonicalisation: TraceCanonicalisationService;
  commands: TraceProcessingCommandsService;
  findSummary: (input: { projectId: string; traceId: string }) => Promise<TraceSummaryData | null>;
  recordTrackedEvent: TrackedEventSyncSubscriberDeps["recordTrackedEvent"];
}

/** trace_processing per role: producers send; consumers fold and react as main's worker did. */
export class TraceProcessingPipelineService {
  static create(input: TraceProcessingPipelineInput): TraceProcessingPipelineService {
    return new TraceProcessingPipelineService(input);
  }

  private constructor(private readonly input: TraceProcessingPipelineInput) {}

  build(setup: { participation: EventingParticipation }): TraceProcessingPipelineDefinition {
    if (setup.participation !== "consume") {
      return TraceProcessingProducerAdapter.createTraceProcessingProducerPipeline({
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
      ioExtraction: TraceIoExtractionAdapter.create(canonicalisation),
      mediaReferences: TraceMediaReferenceAdapter.create(),
      modelCosts: ModelCatalogTraceModelCostAdapter.create(),
      spanNormalization: TraceSpanNormalizationAdapter.create(canonicalisation),
      prepareEventForProjection: (event) => TraceProjectionLeanService.leanForProjection(event),
      recordSpanCommand: EventingRecordSpanAdapter.create({
        piiRedaction: {
          redact: (input) => peers.dataPrivacy.redactSpan(input),
        },
        contentDrop: {
          drop: (span, projectId) => peers.dataPrivacy.dropSpanContent({ span, projectId }),
        },
        costEnrichment: this.#costEnrichment(),
        tokenEstimation: {
          estimate: () =>
            Promise.reject(this.#refuse("span token estimation (no tokenizer installed)")),
        },
      }),
    }).build();
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
    const refusing = (capability: string) => () => Promise.reject(this.#refuse(capability));
    const resolveOrigin = TraceDeferredOriginEventingAdapter.createDeferredOriginHandler((data) =>
      commands.resolveOrigin(data),
    );
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
        metrics: OtelTraceEvaluationLoopMetricsAdapter.create(),
      }),
      customEvaluationSync: CustomEvaluationSync.createCustomEvaluationSyncHandler({
        reportEvaluation: (data) => peers.evaluations.reportEvaluation(data),
        deriveEvaluatorId: (name) => peers.evaluations.deriveEvaluatorId(name),
      }),
      trackedEventSync: TrackedEventSync.createTrackedEventSyncHandler({
        recordTrackedEvent: this.input.recordTrackedEvent,
      }),
      traceUpdateBroadcast: refusing("the trace live-update broadcast"),
      projectMetadata: ProjectMetadataSync.createProjectMetadataHandler({
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
      spanStorageBroadcast: refusing("the span storage broadcast"),
      broadcastDisabled: true,
    };
  }
}
