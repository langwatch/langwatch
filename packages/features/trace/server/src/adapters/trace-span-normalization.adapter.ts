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
 * Span normalization for the projections, over this package's own pipeline
 * service.
 *
 * Frozen twin of the application's `AppTraceSpanNormalizationAdapter`
 * (`platform/app/src/runtime/app/trace-record-span.adapter.ts`). The service it
 * wraps was already packaged; only the port rename sat in the application, and
 * a rename is the last thing that should keep a process from building its own
 * pipeline.
 */
export class TraceSpanNormalizationAdapter extends TraceSpanNormalizationPort {
  private readonly service: SpanNormalizationPipelineService;

  private constructor(canonicalisation: TraceCanonicalisationService) {
    super();
    this.service = new SpanNormalizationPipelineService(canonicalisation);
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
