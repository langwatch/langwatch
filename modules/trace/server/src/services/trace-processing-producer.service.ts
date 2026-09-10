/**
 * One trace_processing definition, two registrations: the worker (consumer) supplies the real
 * dependencies; a producer registers the same definition only for addAnnotation/removeAnnotation,
 * folding nothing. This module supplies stand-ins that construct successfully but refuse by name
 * if ever called — refusing beats a silently-succeeding fold reporting nothing as written.
 */
import type { AppendStore, FoldProjectionStore, TenantId } from "@langwatch/eventing";
import {
  TraceCanonicalisationService,
  type CanonicalizeLogRecordInput,
  type CanonicalizeLogRecordResult,
  type ClassifyClaudeCallInput,
  type ClassifyClaudeCallResult,
  type ExtractMessageTextInput,
  type NormalizedSpan,
  type TraceProcessingEvent,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { TraceIoExtraction } from "../app/trace.infrastructure.ts";
import { TraceMediaReferenceResolver } from "../app/trace.infrastructure.ts";
import { TraceModelCost } from "../app/trace.infrastructure.ts";
import { TraceSpanNormalization } from "../app/trace.infrastructure.ts";
import {
  TraceSpanContentDrop,
  TraceSpanCostEnrichment,
  TraceSpanPiiRedaction,
  TraceSpanTokenEstimation,
} from "../app/trace.infrastructure.ts";
import type { TraceAnalyticsData } from "../projections/trace-derived.projection.ts";
import type { TraceAnalyticsRollupRow } from "../projections/trace-rollup.projection.ts";
import { EventingRecordSpanAdapter } from "./eventing.record-span.service.ts";
import { EventingTracePipelineAdapter } from "./eventing.trace-pipeline.service.ts";

/** Why every stand-in below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the trace_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyFoldStore<TState> implements FoldProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  store(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `write the ${this.name} projection`));
  }

  tryGet(): Promise<TState | null> {
    return Promise.reject(producerOnly(this.processName, `read the ${this.name} projection`));
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyAppendStore<TRow> implements AppendStore<TRow> {
  constructor(
    private readonly processName: string,
    private readonly name: string,
  ) {}

  append(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, `append to the ${this.name} projection`));
  }
}

/**
 * The canonicaliser this process does not hold. Every member throws rather than returning an
 * empty answer — a stand-in answering "nothing" would be read as a span that carried nothing.
 */
class ProducerOnlyCanonicalisation extends TraceCanonicalisationService {
  constructor(private readonly processName: string) {
    super();
  }

  private refuse(): never {
    throw producerOnly(this.processName, "canonicalise span content");
  }

  canonicalizeSpanAttributes(): never {
    this.refuse();
  }

  canonicalizeLogRecord(_input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult {
    this.refuse();
  }

  tryExtractMessageText(_input: ExtractMessageTextInput): string | null {
    this.refuse();
  }

  deriveClaudeRequestContent(): never {
    this.refuse();
  }

  deriveClaudeResponseContent(): never {
    this.refuse();
  }

  classifyClaudeCall(_input: ClassifyClaudeCallInput): ClassifyClaudeCallResult {
    this.refuse();
  }
}

class ProducerOnlyIoExtraction implements TraceIoExtraction {
  constructor(private readonly processName: string) {
  }

  tryExtractRichIOFromSpan(): never {
    throw producerOnly(this.processName, "extract a span's captured input or output");
  }

  tryExtractFallbackIOFromSpan(): never {
    throw producerOnly(this.processName, "extract a span's captured input or output");
  }
}

class ProducerOnlyMediaReferences implements TraceMediaReferenceResolver {
  constructor(private readonly processName: string) {
  }

  private refuse(): never {
    throw producerOnly(this.processName, "resolve a span's media references");
  }

  collect(): never {
    this.refuse();
  }

  parse(): never {
    this.refuse();
  }

  merge(): never {
    this.refuse();
  }

  trySerialize(): never {
    this.refuse();
  }
}

class ProducerOnlyModelCosts implements TraceModelCost {
  constructor(private readonly processName: string) {
  }

  estimate(): number {
    throw producerOnly(this.processName, "price a span against the model catalogue");
  }
}

class ProducerOnlySpanNormalization implements TraceSpanNormalization {
  constructor(private readonly processName: string) {
  }

  normalizeSpanReceived(): NormalizedSpan {
    throw producerOnly(this.processName, "normalise a received span");
  }

  enrichRagContextIds(): void {
    throw producerOnly(this.processName, "enrich a span's RAG context ids");
  }
}

class ProducerOnlyPiiRedaction implements TraceSpanPiiRedaction {
  constructor(private readonly processName: string) {
  }

  redact(_span: unknown, _resource: unknown, _level: unknown, _tenantId: TenantId): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "redact a span"));
  }
}

class ProducerOnlyCostEnrichment implements TraceSpanCostEnrichment {
  constructor(private readonly processName: string) {
  }

  enrich(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "enrich a span with its cost"));
  }
}

class ProducerOnlyTokenEstimation implements TraceSpanTokenEstimation {
  constructor(private readonly processName: string) {
  }

  estimate(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "estimate a span's tokens"));
  }
}

class ProducerOnlyContentDrop implements TraceSpanContentDrop {
  constructor(private readonly processName: string) {
  }

  drop(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "drop a span's captured content"));
  }
}

export class TraceProcessingProducerAdapter {
  static create(): TraceProcessingProducerAdapter {
    return new TraceProcessingProducerAdapter();
  }

  /**
   * Builds the trace-processing definition for a process that only sends commands on it.
   * `processName` names the refusal, so a stand-in reached by accident names which process.
   */
  static createTraceProcessingProducerPipeline(input: { processName: string }) {
    const { processName } = input;
    return EventingTracePipelineAdapter.create({
      spanStore: new ProducerOnlyAppendStore<NormalizedSpan>(processName, "span"),
      summaryStore: new ProducerOnlyFoldStore<TraceSummaryData>(processName, "trace summary"),
      derivedStore: new ProducerOnlyFoldStore<TraceAnalyticsData>(processName, "trace analytics"),
      rollupStore: new ProducerOnlyAppendStore<TraceAnalyticsRollupRow>(
        processName,
        "trace analytics rollup",
      ),
      canonicalisation: new ProducerOnlyCanonicalisation(processName),
      ioExtraction: new ProducerOnlyIoExtraction(processName),
      mediaReferences: new ProducerOnlyMediaReferences(processName),
      modelCosts: new ProducerOnlyModelCosts(processName),
      spanNormalization: new ProducerOnlySpanNormalization(processName),
      // The identity, and it is never reached: preparation only runs on the fold
      // path, and this registration folds nothing.
      prepareEventForProjection: (event: TraceProcessingEvent) => event,
      recordSpanCommand: EventingRecordSpanAdapter.create({
        piiRedaction: new ProducerOnlyPiiRedaction(processName),
        costEnrichment: new ProducerOnlyCostEnrichment(processName),
        tokenEstimation: new ProducerOnlyTokenEstimation(processName),
        contentDrop: new ProducerOnlyContentDrop(processName),
      }),
      // No subscribers: they are consumer-side, and this registration drains
      // nothing. The command routing triple is derived from the pipeline and
      // command names the definition above already declares, which is what the
      // worker routes on.
    })
      .build()
      .build();
  }
}
