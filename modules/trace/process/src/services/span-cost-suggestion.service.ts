import {
  findMatchingModelCost,
  getStaticModelCostRates,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";

interface SpanCostSuggestionInput {
  projectId: string;
  model: string | null;
  cost: number | null | undefined;
  promptTokens: number | null | undefined;
  completionTokens: number | null | undefined;
}

/** Whether a span's detail should offer a cost mapping, and for which model. */
export interface TraceSpanCostSuggestion {
  derive(input: SpanCostSuggestionInput): Promise<{ model: string } | null>;
}

/**
 * Suggests a model cost mapping when a span names a model and carries token usage, yet no cost was
 * computed and neither a project rule nor the static catalogue matches the model. The rule lookup
 * runs last, so only a span showing the unmapped-cost symptom pays for it.
 */
export class SpanCostSuggestionService implements TraceSpanCostSuggestion {
  static create(deps: {
    modelProviders: Pick<ModelProviderApi, "listCosts">;
  }): SpanCostSuggestionService {
    return new SpanCostSuggestionService(deps.modelProviders);
  }

  private constructor(private readonly modelProviders: Pick<ModelProviderApi, "listCosts">) {}

  async derive(input: SpanCostSuggestionInput): Promise<{ model: string } | null> {
    const { model } = input;
    if (!model) return null;
    if (input.cost != null) return null;
    const hasTokens = (input.promptTokens ?? 0) > 0 || (input.completionTokens ?? 0) > 0;
    if (!hasTokens) return null;

    const custom = await this.modelProviders.listCosts({ projectId: input.projectId });
    const costs = [
      ...custom.map(({ model: ruleModel, regex }) => ({ model: ruleModel, regex })),
      ...getStaticModelCostRates(),
    ];
    return findMatchingModelCost(model, costs).length > 0 ? null : { model };
  }
}
