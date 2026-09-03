import {
  TraceSpanCostEnrichmentAdapter,
  type TraceModelCostCatalogPort,
  type TraceSpanCostEnrichmentPort,
} from "@langwatch/trace-server";

/**
 * The rates this process would stamp on a span whose model a customer has
 * priced themselves.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand`'s adapters and still enriches every span it ingests — so
 * nothing in this process prices anything yet. What has to be true today is
 * that this composition root CAN build the path from what it already holds:
 * the model-cost catalog port, which `createWorkerTraceNarrowPorts` already
 * answers from a published `ModelProviderService`. That is the whole
 * dependency list — no Prisma client, no scope resolver, no static registry.
 *
 *     TraceSpanCostEnrichmentPort          (trace-server declares it)
 *       └─ OtlpSpanCostEnrichmentService   (trace-server owns it)
 *            ├─ matchModelCost             (model-provider-contract owns it)
 *            └─ TraceModelCostCatalogPort  the project's own cost rules
 *                 └─ ModelProviderService  scope cascade, three tiers
 *
 * The catalog port is taken rather than built here, because the four-port
 * composition already renames `listCosts` onto it; a second adapter doing the
 * same rename would be a second place for the two to disagree.
 *
 * THE MATCHER IS SHARED, NOT COPIED. The cascade that decides which of a
 * customer's rules prices a span already existed in
 * `@langwatch/model-provider-contract`, private, serving the fold's own cost
 * estimate. Record-time enrichment now calls the same exported function. Two
 * copies would have been two answers to "which rule wins", and the
 * disagreement would show up only as a bill.
 */
export function createWorkerTraceCostEnrichment(options: {
  modelCosts: TraceModelCostCatalogPort;
}): WorkerTraceCostEnrichment {
  return new WorkerTraceCostEnrichment(
    options.modelCosts,
    TraceSpanCostEnrichmentAdapter.create({ modelCosts: options.modelCosts }),
  );
}

/** One process-owned enrichment graph, and the catalog read it rests on. */
export class WorkerTraceCostEnrichment {
  constructor(
    readonly modelCosts: TraceModelCostCatalogPort,
    private readonly enrichment: TraceSpanCostEnrichmentAdapter,
  ) {}

  /** The narrow port `RecordSpanCommand` names, over this graph. */
  spanCostEnrichmentPort(): TraceSpanCostEnrichmentPort {
    return this.enrichment;
  }
}
