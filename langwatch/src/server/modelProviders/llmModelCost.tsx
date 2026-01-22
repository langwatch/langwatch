import escapeStringRegexp from "escape-string-regexp";
import { prisma } from "../db";
import llmModels from "./llmModels.json";
import type { LLMModelRegistry } from "./llmModels.types";

const getImportedModelCosts = () => {
  const registry = llmModels as LLMModelRegistry;
  const models = registry.models;

  // Convert models to cost entries with regex patterns
  const tokenModels: Record<
    string,
    {
      regex: string;
      inputCostPerToken: number;
      outputCostPerToken: number;
    }
  > = {};

  for (const [modelId, model] of Object.entries(models)) {
    if (model.pricing?.inputCostPerToken != null || model.pricing?.outputCostPerToken != null) {
      tokenModels[modelId] = {
        regex:
          "^" +
          // Fix for anthropic/ models not coming with vendor name from litellm
          (modelId.startsWith("claude-") ? "(anthropic\\/)?" : "") +
          escapeStringRegexp(modelId)
            .replaceAll("\\x2d", "-")
            .replaceAll("/", "\\/")
            // Fix for langchain using vertexai while litellm uses vertex_ai
            .replace("vertex_ai", "(vertex_ai|vertexai)") +
          "$",
        inputCostPerToken: model.pricing.inputCostPerToken ?? 0,
        outputCostPerToken: model.pricing.outputCostPerToken ?? 0,
      };
    }
  }

  // Exclude models with : after it if there is already the same model there without the :
  const mergedModels = Object.entries(tokenModels)
    .filter(([model_name, _]) => {
      if (
        model_name.includes(":") &&
        model_name.split(":")[0]! in tokenModels
      ) {
        return false;
      }
      return true;
    })
    .map(([model_name, model]) => {
      return {
        model: model_name,
        regex: model.regex,
        inputCostPerToken: model.inputCostPerToken,
        outputCostPerToken: model.outputCostPerToken,
      };
    });

  // Exclude models with no costs
  const paidModels = mergedModels.filter(
    (model) => model.inputCostPerToken != null || model.outputCostPerToken != null
  );

  // Exclude some vendors (openrouter is already excluded as we're using their API)
  const relevantModels = paidModels.filter(
    (model) => !model.model.includes("openrouter/")
  );

  return Object.fromEntries(
    relevantModels.map((model) => [model.model, model])
  );
};

export type MaybeStoredLLMModelCost = {
  id?: string;
  projectId: string;
  model: string;
  regex: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  updatedAt?: Date;
  createdAt?: Date;
};

export const getLLMModelCosts = async ({
  projectId,
}: {
  projectId: string;
}): Promise<MaybeStoredLLMModelCost[]> => {
  const importedData = getImportedModelCosts();
  const llmModelCostsCustomData = await prisma.customLLMModelCost.findMany({
    where: { projectId },
  });

  const data = llmModelCostsCustomData
    .map(
      (record) =>
        ({
          id: record.id,
          projectId,
          model: record.model,
          regex: record.regex,
          inputCostPerToken: record.inputCostPerToken ?? undefined,
          outputCostPerToken: record.outputCostPerToken ?? undefined,
          updatedAt: record.updatedAt,
          createdAt: record.createdAt,
        }) as MaybeStoredLLMModelCost
    )
    .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
    .concat(
      Object.entries(importedData).map(([key, value]) => ({
        projectId,
        model: key,
        regex: value.regex,
        inputCostPerToken: value.inputCostPerToken,
        outputCostPerToken: value.outputCostPerToken,
      }))
    );

  return data;
};
