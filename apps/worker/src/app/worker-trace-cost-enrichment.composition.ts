import {
  TraceSpanCostEnrichmentAdapter,
  type TraceModelCostCatalog,
  type TraceSpanCostEnrichment,
} from "@langwatch/trace-server";

/**
 * Staged but not mounted; uses the model-cost catalog. The matcher is shared.
 */
export function createWorkerTraceCostEnrichment(options: {
  modelCosts: TraceModelCostCatalog;
}): WorkerTraceCostEnrichment {
  return new WorkerTraceCostEnrichment(
    options.modelCosts,
    TraceSpanCostEnrichmentAdapter.create({ modelCosts: options.modelCosts }),
  );
}

/** One process-owned enrichment graph, and the catalog read it rests on. */
export class WorkerTraceCostEnrichment {
  constructor(
    readonly modelCosts: TraceModelCostCatalog,
    private readonly enrichment: TraceSpanCostEnrichmentAdapter,
  ) {}

  /** The narrow port `EventingRecordSpanAdapter` names, over this graph. */
  spanCostEnrichmentPort(): TraceSpanCostEnrichment {
    return this.enrichment;
  }
}
