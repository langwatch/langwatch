import type { TenantId } from "@langwatch/eventing";
import type { OtlpResource, OtlpSpan, PIIRedactionLevel } from "@langwatch/trace-contract";

export abstract class TraceSpanPiiRedactionPort {
  abstract redact(
    span: OtlpSpan,
    resource: OtlpResource | null,
    level: PIIRedactionLevel,
    tenantId: TenantId,
  ): Promise<void>;
}

export abstract class TraceSpanCostEnrichmentPort {
  abstract enrich(span: OtlpSpan, tenantId: string): Promise<void>;
}

export abstract class TraceSpanTokenEstimationPort {
  abstract estimate(span: OtlpSpan, tenantId: string): Promise<void>;
}

export type TraceSpanContentDropResult = {
  droppedCount: number;
  droppedCategories: string[];
};

export abstract class TraceSpanContentDropPort {
  abstract drop(span: OtlpSpan, projectId: string): Promise<TraceSpanContentDropResult>;
}
