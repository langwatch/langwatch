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
    if (
      model.pricing?.inputCostPerToken != null ||
      model.pricing?.outputCostPerToken != null
    ) {
      // Make vendor prefix optional in regex (e.g., both "gpt-4o" and "openai/gpt-4o" should match)
      const hasVendorPrefix = modelId.includes("/");
      const vendorPrefix = hasVendorPrefix ? modelId.split("/")[0] : null;
      const modelName = hasVendorPrefix
        ? modelId.split("/").slice(1).join("/")
        : modelId;

      const escapedModelName = escapeStringRegexp(modelName)
        // Convert any hex-escaped hyphens (\x2d) to literal hyphens for readability
        .replaceAll("\\x2d", "-")
        // Also convert escaped hyphens (\-) to literal hyphens since they don't need escaping outside character classes
        .replaceAll("\\-", "-")
        // Fix for langchain using vertexai while litellm uses vertex_ai
        .replace("vertex_ai", "(vertex_ai|vertexai)")
        // Allow version numbers to use either dots or hyphens (e.g., "4.6" or "4-6")
        .replaceAll("\\.", "[.-]");

      const escapedVendorPrefix = hasVendorPrefix
        ? escapeStringRegexp(vendorPrefix!)
            .replaceAll("\\x2d", "-")
            .replaceAll("\\-", "-")
        : "";

      const regex = hasVendorPrefix
        ? `^(${escapedVendorPrefix}\\/)?${escapedModelName}$`
        : `^${escapedModelName}$`;

      tokenModels[modelId] = {
        regex,
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
    (model) =>
      model.inputCostPerToken != null || model.outputCostPerToken != null,
  );

  // Exclude some vendors (openrouter is already excluded as we're using their API)
  const relevantModels = paidModels.filter(
    (model) => !model.model.includes("openrouter/"),
  );

  return Object.fromEntries(
    relevantModels.map((model) => [model.model, model]),
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

let cachedStaticModelCosts: MaybeStoredLLMModelCost[] | null = null;

/**
 * Returns static model costs from llmModels.json (no DB query).
 * Cached at module level since the JSON registry is immutable at runtime.
 */
export const getStaticModelCosts = (): MaybeStoredLLMModelCost[] => {
  if (!cachedStaticModelCosts) {
    const importedData = getImportedModelCosts();
    cachedStaticModelCosts = Object.entries(importedData).map(
      ([key, value]) => ({
        projectId: "",
        model: key,
        regex: value.regex,
        inputCostPerToken: value.inputCostPerToken,
        outputCostPerToken: value.outputCostPerToken,
      }),
    );
  }
  return cachedStaticModelCosts;
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
        }) as MaybeStoredLLMModelCost,
    )
    .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
    .concat(
      Object.entries(importedData).map(([key, value]) => ({
        projectId,
        model: key,
        regex: value.regex,
        inputCostPerToken: value.inputCostPerToken,
        outputCostPerToken: value.outputCostPerToken,
      })),
    );

  return data;
};
