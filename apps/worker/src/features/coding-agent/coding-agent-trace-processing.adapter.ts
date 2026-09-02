import { CodingAgentTraceProcessingPort } from "@langwatch/coding-agent-server";
import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import {
  SpanNormalizationPipelineService,
  type TraceStoredSpanReaderPort,
} from "@langwatch/trace-server";

/**
 * The two things the coding-agent span-facts dispatcher asks Trace for, in one
 * object because the port declares them in one.
 *
 * THE READ IS WHY THIS FILE EXISTS. `normalizeSpan` was always composable from
 * packages — it is a rename over `SpanNormalizationPipelineService`, which the
 * canonicalisation service alone builds. `tryGetNormalizedSpan` was not: the
 * only implementation was one query inside the application's 1,970-line
 * `SpanStorageClickHouseRepository`, whose class additionally carries the
 * blob-offload resolver, the visibility gate and every UI read, so asking for
 * it meant asking for the application. It is now
 * `ClickHouseTraceStoredSpanReaderAdapter`, and this composes the two halves.
 *
 * WHAT THE READ IS FOR, because it decides how it must behave. ADR-069 made the
 * dispatcher carry LIFTED FACTS on the job rather than a store read, so the
 * normal path never asks. This answers the REDELIVERY path: a `span_referenced`
 * payload staged by an earlier release, or a full `span_received` the
 * dispatcher must resolve before it can contribute. It runs on the queue's
 * backoff, so a read that widened to an unbounded scan on a miss would re-scan
 * every weekly partition — cold S3 tier included — once per retry. The packaged
 * reader answers a miss as a miss for exactly that reason.
 */
export class WorkerCodingAgentTraceProcessingAdapter extends CodingAgentTraceProcessingPort {
  private constructor(
    private readonly normalization: SpanNormalizationPipelineService,
    private readonly spans: TraceStoredSpanReaderPort,
  ) {
    super();
  }

  static create(options: {
    traceCanonicalisation: TraceCanonicalisationService;
    spans: TraceStoredSpanReaderPort;
  }): WorkerCodingAgentTraceProcessingAdapter {
    return new WorkerCodingAgentTraceProcessingAdapter(
      new SpanNormalizationPipelineService(options.traceCanonicalisation),
      options.spans,
    );
  }

  normalizeSpan(input: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan {
    return this.normalization.normalizeSpanReceived(
      input.tenantId,
      input.span,
      input.resource,
      input.instrumentationScope,
    );
  }

  tryGetNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null> {
    return this.spans.tryGetNormalizedSpan(input);
  }
}
