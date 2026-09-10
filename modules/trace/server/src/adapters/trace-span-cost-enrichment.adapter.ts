import type { OtlpSpan } from "@langwatch/trace-contract";
import type { TraceModelCostCatalogPort } from "../ports/trace-model-cost-catalog.port.ts";
import { TraceSpanCostEnrichmentPort } from "../ports/trace-span-preparation.port.ts";
import { OtlpSpanCostEnrichmentService } from "../services/span/span-cost-enrichment.service.ts";

/**
 * Renames record-time cost enrichment onto the narrow port `RecordSpanCommand`
 * names.
 *
 * The service is not a subclass of the port and must not become one: it takes a
 * named-argument object and the port takes positional arguments, and the port
 * is one of four sibling preparation steps that must stay interchangeable.
 */
export class TraceSpanCostEnrichmentAdapter extends TraceSpanCostEnrichmentPort {
  static create(options: {
    modelCosts: TraceModelCostCatalogPort;
  }): TraceSpanCostEnrichmentAdapter {
    return new TraceSpanCostEnrichmentAdapter(OtlpSpanCostEnrichmentService.create(options));
  }

  private constructor(private readonly service: OtlpSpanCostEnrichmentService) {
    super();
  }

  async enrich(span: OtlpSpan, tenantId: string): Promise<void> {
    await this.service.enrichSpan({ span, tenantId });
  }
}
