import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { customRateAttributesOf, modelCostRatesOf } from "../rules/experiment-model-cost.rules.ts";
import { ExperimentModelCost } from "./experiment-run-orchestrator.service.ts";

const logger = createLogger("langwatch:experiment:run-model-cost");

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
