import type { OtlpSpan } from "@langwatch/trace-contract";
import type { TraceModelCostCatalog } from "../app/trace.members.ts";
import { type TraceSpanCostEnrichment } from "../app/trace.members.ts";
import { OtlpSpanCostEnrichmentService } from "./span/span-cost-enrichment.service.ts";

/**
 * Renames record-time cost enrichment onto the narrow `EventingRecordSpanAdapter`
 * port. Not a subclass: named arguments vs. positional, one of four
 * interchangeable sibling preparation steps.
 */
export class TraceSpanCostEnrichmentAdapter implements TraceSpanCostEnrichment {
  static create(options: {
    modelCosts: TraceModelCostCatalog;
  }): TraceSpanCostEnrichmentAdapter {
    return new TraceSpanCostEnrichmentAdapter(OtlpSpanCostEnrichmentService.create(options));
  }

  private constructor(private readonly service: OtlpSpanCostEnrichmentService) {
  }

  async enrich(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.enrichSpan({ span, tenantId });
  }
}
