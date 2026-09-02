/**
 * The `trace_processing` pipeline as a PRODUCER registers it.
 *
 * One definition, two registrations. The consumer — the worker — supplies the
 * real span store, the three projection stores, the canonicaliser and the
 * span-preparation chain, and drains every routing key the definition
 * declares. A producer registers the SAME definition only to obtain its
 * command dispatchers: `addAnnotation` and `removeAnnotation` off a tRPC call,
 * and nothing else. It starts no consumer loop, holds no event log and folds
 * nothing.
 *
 * Every dependency the definition takes is consumer-side, and a producer has
 * none of them. That is what this module supplies — stand-ins that exist so the
 * definition can be CONSTRUCTED and refuse by name if they are ever CALLED.
 * Refusing rather than no-op'ing is the whole point: a silently-succeeding fold
 * store in a process that was never meant to fold would report a projection as
 * written when nothing was, and the row would simply never appear.
 *
 * Forking the definition instead — declaring only the two commands a producer
 * sends — is the thing this avoids. The routing triple every job carries is
 * derived from the pipeline and command names, so two descriptions of one event
 * stream drift into jobs the worker cannot route.
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
import { TraceIoExtractionPort } from "../ports/trace-io-extraction.port";
import { TraceMediaReferencePort } from "../ports/trace-media-reference.port";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";
import { TraceSpanNormalizationPort } from "../ports/trace-span-normalization.port";
import {
  TraceSpanContentDropPort,
  TraceSpanCostEnrichmentPort,
  TraceSpanPiiRedactionPort,
  TraceSpanTokenEstimationPort,
} from "../ports/trace-span-preparation.port";
import type { TraceAnalyticsData } from "../projections/trace-derived.projection";
import type { TraceAnalyticsRollupRow } from "../projections/trace-rollup.projection";
import { EventingRecordSpanAdapter } from "./eventing.record-span.adapter";
import { EventingTracePipelineAdapter } from "./eventing.trace-pipeline.adapter";

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

  get(): Promise<TState | null> {
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
 * The canonicaliser this process does not hold.
 *
 * Every member throws rather than returning an empty answer: canonicalisation
 * is what decides what a span MEANS, and a stand-in answering "nothing" would
 * be read as a span that carried nothing.
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

class ProducerOnlyIoExtraction extends TraceIoExtractionPort {
  constructor(private readonly processName: string) {
    super();
  }

  tryExtractRichIOFromSpan(): never {
    throw producerOnly(this.processName, "extract a span's captured input or output");
  }

  tryExtractFallbackIOFromSpan(): never {
    throw producerOnly(this.processName, "extract a span's captured input or output");
  }
}

class ProducerOnlyMediaReferences extends TraceMediaReferencePort {
  constructor(private readonly processName: string) {
    super();
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

class ProducerOnlyModelCosts extends TraceModelCostPort {
  constructor(private readonly processName: string) {
    super();
  }

  estimate(): number {
    throw producerOnly(this.processName, "price a span against the model catalogue");
  }
}

class ProducerOnlySpanNormalization extends TraceSpanNormalizationPort {
  constructor(private readonly processName: string) {
    super();
  }

  normalizeSpanReceived(): NormalizedSpan {
    throw producerOnly(this.processName, "normalise a received span");
  }

  enrichRagContextIds(): void {
    throw producerOnly(this.processName, "enrich a span's RAG context ids");
  }
}

class ProducerOnlyPiiRedaction extends TraceSpanPiiRedactionPort {
  constructor(private readonly processName: string) {
    super();
  }

  redact(
    _span: unknown,
    _resource: unknown,
    _level: unknown,
    _tenantId: TenantId,
  ): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "redact a span"));
  }
}

class ProducerOnlyCostEnrichment extends TraceSpanCostEnrichmentPort {
  constructor(private readonly processName: string) {
    super();
  }

  enrich(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "enrich a span with its cost"));
  }
}

class ProducerOnlyTokenEstimation extends TraceSpanTokenEstimationPort {
  constructor(private readonly processName: string) {
    super();
  }

  estimate(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "estimate a span's tokens"));
  }
}

class ProducerOnlyContentDrop extends TraceSpanContentDropPort {
  constructor(private readonly processName: string) {
    super();
  }

  drop(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "drop a span's captured content"));
  }
}

/**
 * Builds the trace-processing definition for a process that only sends
 * commands on it.
 *
 * `processName` names the refusal, so a stand-in reached by accident says which
 * process reached it rather than reporting an anonymous failure.
 */
export function createTraceProcessingProducerPipeline(input: { processName: string }) {
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
