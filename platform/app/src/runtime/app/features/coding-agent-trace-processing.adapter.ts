import { CodingAgentTraceProcessingPort } from "@langwatch/coding-agent-server";
import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import { SpanNormalizationPipelineService } from "~/server/app-layer/traces/span-normalization.service";
import type { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";

export class AppCodingAgentTraceProcessingAdapter extends CodingAgentTraceProcessingPort {
  private readonly normalization: SpanNormalizationPipelineService;

  private constructor(
    traceCanonicalisation: TraceCanonicalisationService,
    private readonly spans: SpanStorageService,
  ) {
    super();
    this.normalization = new SpanNormalizationPipelineService(traceCanonicalisation);
  }

  static create(input: {
    traceCanonicalisation: TraceCanonicalisationService;
    spans: SpanStorageService;
  }): AppCodingAgentTraceProcessingAdapter {
    return new AppCodingAgentTraceProcessingAdapter(input.traceCanonicalisation, input.spans);
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
    return this.spans.getNormalizedSpanById(input);
  }
}
