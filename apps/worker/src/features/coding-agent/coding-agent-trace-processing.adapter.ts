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
 * The two things the coding-agent span-facts dispatcher asks Trace for, in one object because
 * the port declares them in one. THE READ IS WHY THIS FILE EXISTS.
 * WHAT THE READ IS FOR, because it decides how it must behave. ADR-069 made the
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
      SpanNormalizationPipelineService.create(options.traceCanonicalisation),
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
