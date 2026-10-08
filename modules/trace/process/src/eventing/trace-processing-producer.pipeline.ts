/**
 * One trace_processing definition, two registrations: the worker supplies
 * real dependencies; a producer registers the same definition only for
 * add/removeAnnotation, with stand-ins that refuse by name if ever called.
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

import type { TraceSpanNormalization } from "../services/span-normalization.service.ts";
import type { TraceIoExtraction } from "../services/trace-io-extraction.service.ts";
import type { TraceMediaReferenceResolver } from "../services/trace-media-reference.service.ts";
import type { TraceModelCost } from "../services/trace-model-cost.service.ts";
import type {
  TraceSpanContentDrop,
  TraceSpanCostEnrichment,
  TraceSpanPiiRedaction,
  TraceSpanTokenEstimation,
} from "./record-span.commands.ts";
import { EventingRecordSpanAdapter } from "./record-span.commands.ts";
import type { TraceAnalyticsData } from "./trace-derived.projection.ts";
import { EventingTracePipelineAdapter } from "./trace-processing-projections.pipeline.ts";
import type { TraceAnalyticsRollupRow } from "./trace-rollup.projection.ts";

/** Why every stand-in below refuses, naming the module and the role. */
function producerOnly(role: string, capability: string): Error {
  return new Error(
    `trace (${role}) registered the trace_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A fold store that cannot fold, because this process consumes nothing. */
class ProducerOnlyFoldStore<TState> implements FoldProjectionStore<TState> {
  constructor(
    private readonly role: string,
    private readonly name: string,
  ) {}

  store(): Promise<void> {
    return Promise.reject(producerOnly(this.role, `write the ${this.name} projection`));
  }

  get(): Promise<never> {
    return Promise.reject(producerOnly(this.role, `read the ${this.name} projection`));
  }
}

/** An append store that cannot append, for the same reason. */
class ProducerOnlyAppendStore<TRow> implements AppendStore<TRow> {
  constructor(
    private readonly role: string,
    private readonly name: string,
  ) {}

  append(): Promise<void> {
    return Promise.reject(producerOnly(this.role, `append to the ${this.name} projection`));
  }
}

/**
 * The canonicaliser this process does not hold. Every member throws rather than returning an
 * empty answer — a stand-in answering "nothing" would be read as a span that carried nothing.
 */
class ProducerOnlyCanonicalisation extends TraceCanonicalisationService {
  constructor(private readonly role: string) {
    super();
  }

  private refuse(): never {
    throw producerOnly(this.role, "canonicalise span content");
  }

  canonicalizeSpanAttributes(): never {
    this.refuse();
  }

  canonicalizeLogRecord(_input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult {
    this.refuse();
  }

  extractMessageText(_input: ExtractMessageTextInput): string | null {
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
  constructor(private readonly role: string) {}

  extractRichIOFromSpan(): never {
    throw producerOnly(this.role, "extract a span's captured input or output");
  }

  extractFallbackIOFromSpan(): never {
    throw producerOnly(this.role, "extract a span's captured input or output");
  }
}

class ProducerOnlyMediaReferences implements TraceMediaReferenceResolver {
  constructor(private readonly role: string) {}

  private refuse(): never {
    throw producerOnly(this.role, "resolve a span's media references");
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

  serialize(): never {
    this.refuse();
  }
}

class ProducerOnlyModelCosts implements TraceModelCost {
  constructor(private readonly role: string) {}

  estimate(): number {
    throw producerOnly(this.role, "price a span against the model catalogue");
  }
}

class ProducerOnlySpanNormalization implements TraceSpanNormalization {
  constructor(private readonly role: string) {}

  normalizeSpanReceived(): NormalizedSpan {
    throw producerOnly(this.role, "normalise a received span");
  }

  enrichRagContextIds(): void {
    throw producerOnly(this.role, "enrich a span's RAG context ids");
  }
}

class ProducerOnlyPiiRedaction implements TraceSpanPiiRedaction {
  constructor(private readonly role: string) {}

  redact(_input: { tenantId: TenantId }): Promise<void> {
    return Promise.reject(producerOnly(this.role, "redact a span"));
  }
}

class ProducerOnlyCostEnrichment implements TraceSpanCostEnrichment {
  constructor(private readonly role: string) {}

  enrich(): Promise<void> {
    return Promise.reject(producerOnly(this.role, "enrich a span with its cost"));
  }
}

class ProducerOnlyTokenEstimation implements TraceSpanTokenEstimation {
  constructor(private readonly role: string) {}

  estimate(): Promise<void> {
    return Promise.reject(producerOnly(this.role, "estimate a span's tokens"));
  }
}

class ProducerOnlyContentDrop implements TraceSpanContentDrop {
  constructor(private readonly role: string) {}

  drop(): Promise<never> {
    return Promise.reject(producerOnly(this.role, "drop a span's captured content"));
  }
}

/**
 * Builds the trace-processing definition for a process that only sends commands on it.
 * `role` names the refusal, so a stand-in reached by accident names which role it ran in.
 */
export function createTraceProcessingProducerPipeline(input: {
  role: string;
}): ReturnType<ReturnType<EventingTracePipelineAdapter["build"]>["build"]> {
  const { role } = input;
  return EventingTracePipelineAdapter.create({
    spanStore: new ProducerOnlyAppendStore<NormalizedSpan>(role, "span"),
    summaryStore: new ProducerOnlyFoldStore<TraceSummaryData>(role, "trace summary"),
    derivedStore: new ProducerOnlyFoldStore<TraceAnalyticsData>(role, "trace analytics"),
    rollupStore: new ProducerOnlyAppendStore<TraceAnalyticsRollupRow>(
      role,
      "trace analytics rollup",
    ),
    canonicalisation: new ProducerOnlyCanonicalisation(role),
    ioExtraction: new ProducerOnlyIoExtraction(role),
    mediaReferences: new ProducerOnlyMediaReferences(role),
    modelCosts: new ProducerOnlyModelCosts(role),
    spanNormalization: new ProducerOnlySpanNormalization(role),
    // The identity, and it is never reached: preparation only runs on the fold
    // path, and this registration folds nothing.
    prepareEventForProjection: (event: TraceProcessingEvent) => event,
    recordSpanCommand: EventingRecordSpanAdapter.create({
      piiRedaction: new ProducerOnlyPiiRedaction(role),
      costEnrichment: new ProducerOnlyCostEnrichment(role),
      tokenEstimation: new ProducerOnlyTokenEstimation(role),
      contentDrop: new ProducerOnlyContentDrop(role),
    }),
    // No subscribers: they are consumer-side, and this registration drains
    // nothing. The command routing triple is derived from the pipeline and
    // command names the definition above already declares, which is what the
    // worker routes on.
  })
    .build()
    .build();
}
