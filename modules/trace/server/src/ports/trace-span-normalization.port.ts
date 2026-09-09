import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "@langwatch/trace-contract";

export abstract class TraceSpanNormalizationPort {
  abstract normalizeSpanReceived(
    tenantId: string,
    span: OtlpSpan,
    resource: OtlpResource | null,
    instrumentationScope: OtlpInstrumentationScope | null,
  ): NormalizedSpan;

  abstract enrichRagContextIds(span: NormalizedSpan): void;
}
