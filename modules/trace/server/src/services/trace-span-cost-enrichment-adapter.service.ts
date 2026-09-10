import type { OtlpSpan } from "@langwatch/trace-contract";
import type { TraceModelCostCatalog } from "../app/trace.infrastructure.ts";
import { TraceSpanCostEnrichment } from "../app/trace.infrastructure.ts";
import { OtlpSpanCostEnrichmentService } from "./span/span-cost-enrichment.service.ts";

/**
 * Renames record-time cost enrichment onto the narrow port `RecordSpanCommand`
 * names.
 *
 * The service is not a subclass of the port and must not become one: it takes a
 * named-argument object and the port takes positional arguments, and the port
 * is one of four sibling preparation steps that must stay interchangeable.
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
