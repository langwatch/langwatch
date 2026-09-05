import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import { TraceSpanNormalizationPort } from "../ports/trace-span-normalization.port";
import { SpanNormalizationPipelineService } from "../services/span-normalization.service";

/**
 * Span normalization for the projections, over this package's own pipeline service. Frozen twin
 * of the application's `AppTraceSpanNormalizationAdapter`
 * (`platform/app/src/runtime/app/trace-record-span.adapter.ts`).
 */
export class TraceSpanNormalizationAdapter extends TraceSpanNormalizationPort {
  private readonly service: SpanNormalizationPipelineService;

  private constructor(canonicalisation: TraceCanonicalisationService) {
    super();
    this.service = SpanNormalizationPipelineService.create(canonicalisation);
  }

  static create(canonicalisation: TraceCanonicalisationService): TraceSpanNormalizationAdapter {
    return new TraceSpanNormalizationAdapter(canonicalisation);
  }

  normalizeSpanReceived(
    tenantId: string,
    span: OtlpSpan,
    resource: OtlpResource | null,
    instrumentationScope: OtlpInstrumentationScope | null,
  ) {
    return this.service.normalizeSpanReceived(tenantId, span, resource, instrumentationScope);
  }

  enrichRagContextIds(span: NormalizedSpan): void {
    this.service.enrichRagContextIds(span);
  }
}
