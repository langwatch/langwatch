import escapeStringRegexp from "escape-string-regexp";
// @ts-ignore
import * as llmModelCosts from "./llmModelCosts.json";
import { prisma } from "../db";

const getImportedModelCosts = () => {
  type ImportedLLMModelCost =
    (typeof llmModelCosts)[keyof typeof llmModelCosts];

  const models: Record<string, ImportedLLMModelCost> =
    "default" in llmModelCosts
      ? (llmModelCosts.default as typeof llmModelCosts)
      : llmModelCosts;

  // Filter only models based on input and output costs per token
  const tokenModels: Record<
    string,
    {
      regex: string;
      inputCostPerToken: number;
      outputCostPerToken: number;
    }
  > = Object.fromEntries(
    Object.entries(models)
      .filter(
        ([_, model]) =>
          "input_cost_per_token" in model &&
          "output_cost_per_token" in model &&
          typeof model.input_cost_per_token === "number" &&
          typeof model.output_cost_per_token === "number"
      )
      .map(([model_name, model]) => {
        const model_ = model as {
          input_cost_per_token: number;
          output_cost_per_token: number;
        };

        return [
          model_name,
          {
            regex:
              "^" +
              // Fix for anthropic/ models not comming with vendor name from litellm
              (model_name.startsWith("claude-") ? "(anthropic\\/)?" : "") +
              escapeStringRegexp(model_name)
                // @ts-ignore
                .replaceAll("\\x2d", "-")
                .replaceAll("/", "\\/")
                // Fix for langchain using vertexai while litellm uses vertex_ai
                .replace("vertex_ai", "(vertex_ai|vertexai)") +
              "$",
            inputCostPerToken: model_.input_cost_per_token,
            outputCostPerToken: model_.output_cost_per_token,
          },
        ];
      })
  );

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
    (model) => !!model.inputCostPerToken || !!model.outputCostPerToken
  );

  // Exclude some vendors
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
