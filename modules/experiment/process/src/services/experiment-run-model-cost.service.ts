import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { customRateAttributesOf, modelCostRatesOf } from "../rules/experiment-model-cost.rules.ts";
const logger = createLogger("langwatch:experiment:run-model-cost");

/**
 * What a cell's tokens cost, in the deployment's own rate table: never Experiment's data nor
 * portable, since self-hosting prices the same model differently. `undefined`: no known rate.
 */
export abstract class ExperimentModelCost {
  abstract findTokenPrice(input: {
    projectId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
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
  }: {
    projectId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<number | undefined> {
    const priced = this.modelProviders.estimateCost({
      attrs: await this.customRateAttributes({ projectId, model }),
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
    });

    return priced > 0 ? priced : undefined;
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
