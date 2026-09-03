import type {
  NormalizedSpan,
  OtlpInstrumentationScope,
  OtlpResource,
  OtlpSpan,
} from "@langwatch/trace-contract";

export abstract class CodingAgentTraceProcessingPort {
  abstract normalizeSpan(input: {
    tenantId: string;
    span: OtlpSpan;
    resource: OtlpResource | null;
    instrumentationScope: OtlpInstrumentationScope | null;
  }): NormalizedSpan;

  abstract tryGetNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null>;
}
