import {
  getStaticModelCostRates,
  type ModelCostRate,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import {
  customRateAttributesOf,
  modelCostRatesOf,
} from "../../../rules/experiment-model-cost.rules.ts";
const logger = createLogger("langwatch:experiment:run-model-cost");

/** The span attributes estimateCost reads cache counts from (model-cost.ts keeps them private). */
const CACHE_READ_TOKENS_ATTR = "gen_ai.usage.cache_read.input_tokens";
const CACHE_CREATION_TOKENS_ATTR = "gen_ai.usage.cache_creation.input_tokens";

/**
 * What a cell's tokens cost, in the deployment's own rate table: never Experiment's data nor
 * portable, since self-hosting prices the same model differently. `undefined`: no known rate.
 */
export abstract class ExperimentModelCost {
  abstract findTokenPrice(input: {
    projectId: string;
    model: string;
    /** The provider's prompt total, cached tokens included. */
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }): Promise<number | undefined>;
}

/** A cell's token price: the project's own matching rule first, then the platform catalogue. */
export class ExperimentRunModelCostService extends ExperimentModelCost {
  static create({
    modelProviders,
  }: {
    modelProviders: Pick<ModelProviderApi, "estimateCost" | "listCosts">;
  }): ExperimentRunModelCostService {
    return new ExperimentRunModelCostService(modelProviders);
  }

  private constructor(
    private readonly modelProviders: Pick<ModelProviderApi, "estimateCost" | "listCosts">,
  ) {
    super();
  }

  async findTokenPrice({
    projectId,
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  }: {
    projectId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  }): Promise<number | undefined> {
    const customRates = await this.customRateAttributes({ projectId, model });
    // The cost cascade prices fresh input and cache counts as disjoint, but the
    // gateway's prompt total includes the cached tokens: take them out here, once.
    const priced = this.modelProviders.estimateCost({
      attrs: {
        ...customRates,
        [CACHE_READ_TOKENS_ATTR]: cacheReadTokens,
        [CACHE_CREATION_TOKENS_ATTR]: cacheCreationTokens,
      },
      model,
      promptTokens: Math.max(0, inputTokens - cacheReadTokens - cacheCreationTokens),
      completionTokens: outputTokens,
    });

    return priced > 0 ? priced : undefined;
  }

  /** The project's custom cost rules ahead of the static catalogue, as main's getLLMModelCosts. */
  async listFor({ projectId }: { projectId: string }): Promise<readonly ModelCostRate[]> {
    return [
      ...modelCostRatesOf(await this.modelProviders.listCosts({ projectId })),
      ...getStaticModelCostRates(),
    ];
  }

  /** An unreadable rule set prices from the catalogue alone: a cell never fails on it. */
  private async customRateAttributes({
    projectId,
    model,
  }: {
    projectId: string;
    model: string;
  }): Promise<Record<string, number>> {
    try {
      const stored = await this.modelProviders.listCosts({ projectId });

      return customRateAttributesOf({ model, rates: modelCostRatesOf(stored) });
    } catch (error) {
      logger.warn(
        { projectId, model, error },
        "custom model costs unreadable; pricing from the catalogue",
      );

      return {};
    }
  }
}
