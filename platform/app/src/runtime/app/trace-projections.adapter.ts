import type { AppendStore, FoldProjectionStore } from "@langwatch/eventing";
import {
  EventingTracePipelineAdapter,
  RecordSpanCommand,
  SpanStorageMapProjection,
  type TraceAnalyticsData,
  TraceAnalyticsRollupMapProjection,
  type TraceAnalyticsRollupRow,
  TraceIOAccumulationService,
  TraceProjectionRuntimeService,
} from "@langwatch/trace-server";
import type {
  NormalizedAttributes,
  NormalizedSpan,
  TraceCanonicalisationService,
  TraceSummaryData,
} from "@langwatch/trace-contract";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { AppTraceSpanNormalizationAdapter } from "./trace-record-span.adapter";
import { leanForProjection } from "~/server/app-layer/traces/lean-for-projection";
import {
  collectMediaRefs,
  mergeMediaRefs,
  parseMediaRefs,
  serializeMediaRefList,
} from "~/shared/traces/media-refs";

type TraceProjectionStores = {
  spanStore: AppendStore<NormalizedSpan>;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  derivedStore: FoldProjectionStore<TraceAnalyticsData>;
  rollupStore: AppendStore<TraceAnalyticsRollupRow>;
  recordSpanCommand: RecordSpanCommand;
  spanCommandShardCount?: number;
};

class AppTraceIoExtractionAdapter {
  private constructor(private readonly service: TraceIOExtractionService) {}

  static create(canonicalisation: TraceCanonicalisationService): AppTraceIoExtractionAdapter {
    return new AppTraceIoExtractionAdapter(new TraceIOExtractionService(canonicalisation));
  }

  static fromService(service: TraceIOExtractionService): AppTraceIoExtractionAdapter {
    return new AppTraceIoExtractionAdapter(service);
  }

  tryExtractRichIOFromSpan: TraceIOExtractionService["extractRichIOFromSpan"] = (span, side) =>
    this.service.extractRichIOFromSpan(span, side);

  tryExtractFallbackIOFromSpan: TraceIOExtractionService["extractFallbackIOFromSpan"] = (
    span,
    side,
  ) => this.service.extractFallbackIOFromSpan(span, side);
}

class AppTraceMediaReferenceAdapter {
  static create(): AppTraceMediaReferenceAdapter {
    return new AppTraceMediaReferenceAdapter();
  }

  collect = collectMediaRefs;
  parse = parseMediaRefs;
  merge = mergeMediaRefs;
  trySerialize = serializeMediaRefList;
}

class AppTraceModelCostAdapter {
  static create(): AppTraceModelCostAdapter {
    return new AppTraceModelCostAdapter();
  }

  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number;
    completionTokens: number;
  }): number {
    return computeSpanCost({
      attrs: input.attributes,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    });
  }
}

/** App-only composition bridge for Trace's external technical ports. */
export class AppTraceProjectionsAdapter {
  private constructor(
    private readonly canonicalisation: TraceCanonicalisationService,
    private readonly stores: TraceProjectionStores,
  ) {}

  static create(options: {
    canonicalisation: TraceCanonicalisationService;
    spanStore: AppendStore<NormalizedSpan>;
    summaryStore: FoldProjectionStore<TraceSummaryData>;
    derivedStore: FoldProjectionStore<TraceAnalyticsData>;
    rollupStore: AppendStore<TraceAnalyticsRollupRow>;
    recordSpanCommand: RecordSpanCommand;
    spanCommandShardCount?: number;
  }): AppTraceProjectionsAdapter {
    return new AppTraceProjectionsAdapter(options.canonicalisation, options);
  }

  static createRuntime(
    canonicalisation: TraceCanonicalisationService,
  ): TraceProjectionRuntimeService {
    return TraceProjectionRuntimeService.create({
      canonicalisation,
      ioExtraction: AppTraceIoExtractionAdapter.create(canonicalisation),
      mediaReferences: AppTraceMediaReferenceAdapter.create(),
      modelCosts: AppTraceModelCostAdapter.create(),
      spanNormalization: AppTraceSpanNormalizationAdapter.create(canonicalisation),
    });
  }

  static createSpanStorageProjection(options: {
    canonicalisation: TraceCanonicalisationService;
    store: AppendStore<NormalizedSpan>;
  }): SpanStorageMapProjection {
    const runtime = this.createRuntime(options.canonicalisation);

    return SpanStorageMapProjection.create({
      store: options.store,
      spanCostService: runtime.spanCost,
      spanNormalization: runtime.spanNormalization,
    });
  }

  static createAnalyticsRollupProjection(options: {
    canonicalisation: TraceCanonicalisationService;
    store: AppendStore<TraceAnalyticsRollupRow>;
  }): TraceAnalyticsRollupMapProjection {
    const runtime = this.createRuntime(options.canonicalisation);

    return TraceAnalyticsRollupMapProjection.create({
      store: options.store,
      spanCostService: runtime.spanCost,
      spanNormalization: runtime.spanNormalization,
    });
  }

  static createIoAccumulationService(options: {
    canonicalisation: TraceCanonicalisationService;
    extraction: TraceIOExtractionService;
  }): TraceIOAccumulationService {
    return TraceIOAccumulationService.create(
      AppTraceIoExtractionAdapter.fromService(options.extraction),
      options.canonicalisation,
      AppTraceMediaReferenceAdapter.create(),
    );
  }

  compose() {
    return EventingTracePipelineAdapter.create({
      ...this.stores,
      canonicalisation: this.canonicalisation,
      ioExtraction: AppTraceIoExtractionAdapter.create(this.canonicalisation),
      mediaReferences: AppTraceMediaReferenceAdapter.create(),
      modelCosts: AppTraceModelCostAdapter.create(),
      spanNormalization: AppTraceSpanNormalizationAdapter.create(this.canonicalisation),
      prepareEventForProjection: leanForProjection,
    }).build();
  }
}
