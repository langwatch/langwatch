import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EventingParticipation, FoldReadAuthorizer } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { TraceCanonicalisationService, TraceSummaryData } from "@langwatch/trace-contract";

import type { TraceTokenCounter } from "../channels/token-counter.channel.ts";
import { TraceIoExtractionAdapterService } from "../features/derivation/services/trace-io-extraction-adapter.service.ts";
import { TraceModelCostService } from "../features/derivation/services/trace-model-cost.service.ts";
import type { TraceBlobStoreService } from "../features/media/services/trace-blob-store.service.ts";
import { TraceMediaReferenceService } from "../features/media/services/trace-media-reference.service.ts";
import { leanForProjection } from "../features/projection/rules/trace-projection-lean.rules.ts";
import { OtlpSpanCostEnrichmentService } from "../features/span/services/span-cost-enrichment.service.ts";
import { OtlpSpanTokenEstimationService } from "../features/span/services/span-token-estimation.service.ts";
import { TraceSpanNormalizationAdapterService } from "../features/span/services/trace-span-normalization-adapter.service.ts";
import type { TraceRepositories } from "../repositories/trace.repositories.ts";
import type { TraceEvaluationOutcomeService } from "../services/trace-evaluation-outcome.service.ts";
import type { TraceProcessingCommandsService } from "../services/trace-processing-commands.service.ts";
import {
  createDeferredOriginHandler,
  WRITE_COMPACT_ORIGIN_JOBS,
} from "./deferred-origin.subscriber.ts";
import {
  createProjectMetadataHandler,
  type ProjectMetadataSubscriberDeps,
} from "./project-metadata.subscriber.ts";
import type {
  TraceSpanCostEnrichment,
  TraceSpanSpool,
  TraceSpanTokenEstimation,
} from "./record-span.commands.ts";
import { EventingRecordSpanAdapter } from "./record-span.commands.ts";
import { SpanAnalyticsStore } from "./span-analytics.store.ts";
import { createSpanStorageBroadcastHandler } from "./span-storage-broadcast.subscriber.ts";
import { SpanStorageStore } from "./span-storage.store.ts";
import { TraceAnalyticsStore } from "./trace-derived.store.ts";
import { TraceEvaluationAnalyticsStore } from "./trace-evaluation-analytics.store.ts";
import {
  createTraceFailedHandler,
  type TraceFailedSubscriberDeps,
} from "./trace-failed.subscriber.ts";
import { createTraceProcessingProducerPipeline } from "./trace-processing-producer.pipeline.ts";
import type { TraceProcessingPipelineDefinition } from "./trace-processing-projections.pipeline.ts";
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
  dataPrivacy: Pick<DataPrivacyApi, "redactSpan" | "dropSpanContent">;
  dataRetention: Pick<
    DataRetentionApi,
    "getPlatformDefaultRetentionDays" | "getResolvedForProject"
  >;
  featureFlags: FeatureFlagApi;
  modelProviders: Pick<ModelProviderApi, "listCosts">;
  projects: Pick<
    ProjectApi,
    "findById" | "updateMetadata" | "resolveOrgAdmin" | "findOrganizationId"
  >;
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
    | "evaluationAnalytics"
    | "spanAnalytics"
    | "summaryFoldCache"
    | "analyticsFoldCache"
  >;
  canonicalisation: TraceCanonicalisationService;
  commands: TraceProcessingCommandsService;
  /**
   * The ADR-022 spool the ingestion door writes an over-threshold command to. Required: a
   * record-span command built without it refuses every spooled span, and the group blocks.
   */
  spool: Pick<TraceBlobStoreService, "getSpool" | "deleteSpool">;
  findSummary: (input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }) => Promise<TraceSummaryData | null>;
  recordTrackedEvent: TrackedEventSyncSubscriberDeps["recordTrackedEvent"];
  /** Tells a tenant's open tabs a trace moved; presence relays it in the serving process. */
  broadcast: Pick<PresenceApi, "publishProjectEvent">;
  /** Where a project's first and later traces, and each trace that failed, are recorded. */
  milestones: ProjectMetadataSubscriberDeps["milestones"] & TraceFailedSubscriberDeps["milestones"];
  /** Mints the own-only proof the summary and analytics fold stores read back through. */
  authorizeFoldRead: FoldReadAuthorizer;
  /** Records evaluation's COMPLETED and REPORTED as outcomes on their traces (ADR-003). */
  evaluationOutcomes?: Pick<TraceEvaluationOutcomeService, "recordCompleted" | "recordReported">;
  /** Test-only: overrides `WRITE_COMPACT_ORIGIN_JOBS`; production never passes it. */
  writeCompactOriginJobs?: boolean;
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
    const { peers, repositories, canonicalisation, authorizeFoldRead } = this.input;
    const defaultRetentionDays = (): number =>
      peers.dataRetention.getPlatformDefaultRetentionDays();
    return EventingTracePipelineAdapter.create({
      spanStore: SpanStorageStore.create({
        storage: repositories.spanStorage,
        defaultRetentionDays,
      }),
      summaryStore: repositories.summaryFoldCache.cached(
        TraceSummaryStore.create({
          storage: repositories.summaryProjection,
          defaultRetentionDays,
          authorize: authorizeFoldRead,
        }),
      ),
      derivedStore: repositories.analyticsFoldCache.cached(
        TraceAnalyticsStore.create({
          storage: repositories.analyticsProjection,
          evaluationAnalytics: TraceEvaluationAnalyticsStore.create({
            storage: repositories.evaluationAnalytics,
            defaultRetentionDays,
            authorize: authorizeFoldRead,
          }),
          defaultRetentionDays,
          authorize: authorizeFoldRead,
        }),
      ),
      rollupStore: TraceAnalyticsRollupStore.create({
        storage: repositories.analyticsRollup,
        defaultRetentionDays,
      }),
      spanAnalyticsStore: SpanAnalyticsStore.create({
        storage: repositories.spanAnalytics,
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
        spool: this.#spool(),
      }),
      ...(this.input.evaluationOutcomes
        ? { evaluationOutcomes: this.input.evaluationOutcomes }
        : {}),
    })
      .build()
      .withRetention({
        resolve: (tenantId) => peers.dataRetention.getResolvedForProject({ projectId: tenantId }),
      });
  }

  #spool(): TraceSpanSpool {
    const { spool } = this.input;
    return {
      read: async (identity) => (await spool.getSpool(identity)).toString("utf8"),
      delete: (identity) => spool.deleteSpool(identity),
    };
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
    const resolveOrigin = createDeferredOriginHandler((data) => commands.resolveOrigin(data));
    return {
      resolveDeferredOrigin: async ({ tenantId, traceId, occurredAtMs }) => {
        const summary = await this.input.findSummary({
          projectId: tenantId,
          traceId,
          occurredAtMs,
        });
        if (summary?.attributes["langwatch.origin"]) return;
        await resolveOrigin({ id: traceId, tenantId, traceId });
      },
      trackedEventSync: createTrackedEventSyncHandler({
        recordTrackedEvent: this.input.recordTrackedEvent,
      }),
      traceUpdateBroadcast: createTraceUpdateBroadcastHandler({ broadcast: this.input.broadcast }),
      projectMetadata: createProjectMetadataHandler({
        projects: peers.projects,
        milestones: this.input.milestones,
      }),
      traceFailed: createTraceFailedHandler({ milestones: this.input.milestones }),
      spanStorageBroadcast: createSpanStorageBroadcastHandler({ broadcast: this.input.broadcast }),
      broadcastDisabled: false,
      writeCompactOriginJobs: this.input.writeCompactOriginJobs ?? WRITE_COMPACT_ORIGIN_JOBS,
    };
  }
}
