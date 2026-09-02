import { estimateModelCost, getStaticModelCostRates } from "@langwatch/model-provider-contract";
import type { NormalizedAttributes } from "@langwatch/trace-contract";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";

/**
 * Fold-time span cost, priced from the platform's immutable model catalog.
 *
 * Frozen twin of the application's `computeSpanCost`
 * (`platform/app/src/server/app-layer/traces/model-cost-matching.ts`), and the
 * SURVEY SHRANK THE WORK TO NOTHING: those 36 lines are
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
    return estimateModelCost(
      {
        attrs: input.attributes,
        model: input.model,
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
      },
      getStaticModelCostRates(),
    );
  }
}
