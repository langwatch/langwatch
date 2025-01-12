import { Tiktoken } from "tiktoken/lite";
import { load } from "tiktoken/load";
// @ts-ignore
import registry from "tiktoken/registry.json";
// @ts-ignore
import models from "tiktoken/model_to_encoding.json";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../modelProviders/llmModelCost";
import * as Sentry from "@sentry/nextjs";
import NodeFetchCache, { FileSystemCache } from "node-fetch-cache";

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

const loadingModel = new Set<string>();

const initTikToken = async (
  modelName: string
): Promise<{ encoder: Tiktoken } | undefined> => {
  const fallback = "gpt-4";
  const tokenizer =
    modelName in models
      ? (models as any)[modelName]
      : (models as any)[fallback];

  const startedWaiting = Date.now();
  while (loadingModel.has(tokenizer)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() - startedWaiting > 10000) {
      console.warn(`Timeout waiting for ${tokenizer} tokenizer`);
      loadingModel.delete(tokenizer);
      break;
    }
  }

  if (!cachedModel[tokenizer]) {
    loadingModel.add(tokenizer);
    const startTime = Date.now();
    const registryInfo = (registry as any)[tokenizer];
    const fetch = NodeFetchCache.create({
      cache: new FileSystemCache({
        cacheDirectory: "node_modules/.cache/tiktoken",
        ttl: 1000 * 60 * 60 * 24 * 365, // 1 year
      }),
    });
    const model = await load(registryInfo, (url) =>
      fetch(url).then((r) => r.text())
    );
    console.info(
      `Initialized ${tokenizer} tokenizer in ${Date.now() - startTime}ms`
    );
    const encoder = new Tiktoken(
      model.bpe_ranks,
      model.special_tokens,
      model.pat_str
    );

    cachedModel[tokenizer] = { model, encoder };
    loadingModel.delete(tokenizer);
  }

  return cachedModel[tokenizer];
};

async function countTokens(
  llmModelCost: MaybeStoredLLMModelCost,
  text: string | undefined
): Promise<number | undefined> {
  if (!text) return 0;

  const model = llmModelCost.model.includes("/")
    ? llmModelCost.model.split("/")[1]!
    : llmModelCost.model;

  const tiktoken = await initTikToken(model);
  if (!tiktoken) return undefined;

  return tiktoken.encoder.encode(text).length;
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
  return await Sentry.startSpan(
    { name: "tokenizeAndEstimateCost" },
    async () => {
      const inputTokens = (await countTokens(llmModelCost, input)) ?? 0;
      const outputTokens = (await countTokens(llmModelCost, output)) ?? 0;

      const cost = estimateCost({ llmModelCost, inputTokens, outputTokens });

      return {
        inputTokens,
        outputTokens,
        cost,
      };
    }
  );
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

// Pre-warm most used models
initTikToken("gpt-4");
initTikToken("gpt-4o");
