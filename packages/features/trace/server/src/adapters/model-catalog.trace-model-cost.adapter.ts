import type { NormalizedAttributes } from "@langwatch/trace-contract";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";
import { computeSpanCost } from "../services/trace-span-cost-matching.service";

/**
 * Fold-time span cost, priced from the platform's immutable model catalog.
 *
 * It IS `computeSpanCost` — the application's own function, now this package's
 * (`services/trace-span-cost-matching.service.ts`), which the legacy span
 * mapper and the stored-span reader also price through. It was a frozen twin
 * while both graphs ingested; now there is one, and the SURVEY THAT SHRANK THE
 * WORK TO NOTHING still explains why: those 36 lines are
 * `estimateModelCost(input, getStaticModelCosts())`, and `getStaticModelCosts`
 * is `getStaticModelCostRates()` with a `projectId: ""` stamped on each rate —
 * a field `estimateModelCost` never reads. Both functions were already in
 * `@langwatch/model-provider-contract`. So the application's fold prices spans
 * from the STATIC catalog, and this is the same cascade over the same rates,
 * not a second implementation of it.
 *
 * THIS CORRECTS A RECORDED BLOCKER. The extraction ledger has Scenario's
 * `deriveScenarioRoleMetrics` blocked because it is "the App's per-project
 * span-cost matching, not the static-catalog trick". It is the static-catalog
 * trick: `TraceReadDerivationService` builds its `SpanCostService` over this
 * same `computeSpanCost`. Per-project, per-team and per-organization override
 * rules are read by RECORD-TIME enrichment (`getCustomLLMModelCosts` ->
 * `OtlpSpanCostEnrichmentService`), which is a different pass, already
 * harvested, and correctly still needs a database. Nothing on the fold path
 * does.
 *
 * A customer's own rates are not missing here either: an override that applied
 * at record time rides on the span as `custom_input_rate` and its siblings,
 * which `estimateModelCost` reads before it consults the catalog. So a tenant
 * who repriced a model is priced identically by both graphs.
 */
export class ModelCatalogTraceModelCostAdapter extends TraceModelCostPort {
  static create(): ModelCatalogTraceModelCostAdapter {
    return new ModelCatalogTraceModelCostAdapter();
  }

  private constructor() {
    super();
  }

  estimate(input: {
    attributes: NormalizedAttributes;
    model: string | undefined;
    promptTokens: number | null;
    completionTokens: number | null;
  }): number {
    return computeSpanCost({
      attrs: input.attributes,
      ...(input.model === undefined ? {} : { model: input.model }),
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
    });
  }
}
