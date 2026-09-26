import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";

import { type TraceSpanNormalization } from "../app/trace.members.ts";
import { SpanNormalizationPipelineService } from "./span-normalization.service.ts";

/**
 * Span normalization for the projections, over this package's own pipeline service. Frozen twin
 * of the application's `AppTraceSpanNormalizationAdapter`
 * (`platform/app/src/runtime/app/trace-record-span.adapter.ts`).
 */
export class TraceSpanNormalizationAdapter implements TraceSpanNormalization {
  private readonly service: SpanNormalizationPipelineService;

  private constructor(canonicalisation: TraceCanonicalisationService) {
    this.service = SpanNormalizationPipelineService.create(canonicalisation);
  }

  static create(canonicalisation: TraceCanonicalisationService): TraceSpanNormalizationAdapter {
    return new TraceSpanNormalizationAdapter(canonicalisation);
  }

  normalizeSpanReceived({
    tenantId,
    span,
    resource,
    instrumentationScope,
  }: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan {
    return this.service.normalizeSpanReceived({ tenantId, span, resource, instrumentationScope });
  }

  enrichRagContextIds(span: NormalizedSpan): void {
    this.service.enrichRagContextIds(span);
  }
}
