import { Tiktoken } from "tiktoken/lite";
import { load } from "tiktoken/load";
// @ts-ignore
import registry from "tiktoken/registry.json";
// @ts-ignore
import models from "tiktoken/model_to_encoding.json";
import { getLLMModelCosts, type MaybeStoredLLMModelCost } from "../../../modelProviders/llmModelCost";

const cachedModel: Record<
  string,
  {
    model: {
      explicit_n_vocab: number | undefined;
      pat_str: string;
      special_tokens: Record<string, number>;
      bpe_ranks: string;
    };
    encoder: Tiktoken;
  }
> = {};

const initTikToken = async (modelName: string) => {
  const fallback = "gpt-4";
  const tokenizer =
    modelName in models
      ? (models as any)[modelName]
      : (models as any)[fallback];
  if (!cachedModel[tokenizer]) {
    console.info(`Initializing ${tokenizer} tokenizer`);
    const registryInfo = (registry as any)[tokenizer];
    const model = await load(registryInfo);
    const encoder = new Tiktoken(
      model.bpe_ranks,
      model.special_tokens,
      model.pat_str
    );

    cachedModel[tokenizer] = { model, encoder };
  }

  return cachedModel[tokenizer];
};

async function countTokens(
  llmModelCost: MaybeStoredLLMModelCost,
  text: string
) {
  if (!text) return 0;

  const model = llmModelCost.model.includes("/")
    ? llmModelCost.model.split("/")[1]!
    : llmModelCost.model;

  const { encoder } = await initTikToken(model);

  return encoder.encode(text).length;
}

export async function tokenizeAndEstimateCost({
  llmModelCost,
  input,
  output,
}: {
  llmModelCost: MaybeStoredLLMModelCost;
  input?: string;
  output?: string;
}): Promise<{
  inputTokens: number;
  outputTokens: number;
  cost: number | undefined;
}> {
  const inputTokens = (input && (await countTokens(llmModelCost, input))) || 0;
  const outputTokens =
    (output && (await countTokens(llmModelCost, output))) || 0;

  const cost = estimateCost({ llmModelCost, inputTokens, outputTokens });

  return {
    inputTokens,
    outputTokens,
    cost,
  };
}

export function estimateCost({
  llmModelCost,
  inputTokens,
  outputTokens,
}: {
  llmModelCost: MaybeStoredLLMModelCost;
  inputTokens?: number;
  outputTokens?: number;
}): number | undefined {
  return !!llmModelCost?.inputCostPerToken || !!llmModelCost?.outputCostPerToken
    ? (inputTokens ?? 0) * (llmModelCost.inputCostPerToken ?? 0) +
        (outputTokens ?? 0) * (llmModelCost.outputCostPerToken ?? 0)
    : undefined;
}

export const matchingLLMModelCost = (
  model: string,
  llmModelCosts: MaybeStoredLLMModelCost[]
): MaybeStoredLLMModelCost | undefined => {
  const llmModelCost = llmModelCosts.find((llmModelCost) =>
    new RegExp(llmModelCost.regex).test(model)
  );
  if (!llmModelCost && model.includes("/")) {
    const model_ = model.split("/")[1]!;
    return matchingLLMModelCost(model_, llmModelCosts);
  }
  return llmModelCost;
};

export const getMatchingLLMModelCost = async (
  projectId: string,
  model: string
) => {
  const llmModelCosts = await getLLMModelCosts({ projectId });
  return matchingLLMModelCost(model, llmModelCosts);
};
