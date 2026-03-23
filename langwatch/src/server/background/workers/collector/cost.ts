import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import { createLogger } from "../../../../utils/logger/server";
import { startSpan } from "../../../../utils/posthogErrorCapture";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../modelProviders/llmModelCost";
import { isBuildOrNoRedis } from "../../../redis";

const logger = createLogger("langwatch:workers:collector:cost");

const tiktokenClient = new TiktokenClient();

async function countTokens(
  llmModelCost: MaybeStoredLLMModelCost,
  text: string | undefined,
): Promise<number | undefined> {
  if (!text) return 0;

  const model = llmModelCost.model.includes("/")
    ? llmModelCost.model.substring(llmModelCost.model.indexOf("/") + 1)
    : llmModelCost.model;

  return tiktokenClient.countTokens(model, text);
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
  return await startSpan({ name: "tokenizeAndEstimateCost" }, async () => {
    const inputTokens = (await countTokens(llmModelCost, input)) ?? 0;
    const outputTokens = (await countTokens(llmModelCost, output)) ?? 0;

    const cost = estimateCost({ llmModelCost, inputTokens, outputTokens });

    return {
      inputTokens,
      outputTokens,
      cost,
    };
  });
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

/**
 * Normalize model name for better matching:
 * - Convert to lowercase
 * - Normalize common vendor prefix variations
 * - Remove quantization variant suffixes (FP8, GPTQ, etc.)
 */
export const normalizeModelName = (model: string): string => {
  let normalized = model.toLowerCase();

  const vendorMappings: Record<string, string> = {
    "deepseek-ai/": "deepseek/",
    "minimaxai/": "minimax/",
    "zai-org/": "z-ai/",
    "zhipu-ai/": "z-ai/",
  };

  for (const [from, to] of Object.entries(vendorMappings)) {
    if (normalized.startsWith(from)) {
      normalized = normalized.replace(from, to);
      break;
    }
  }

  const suffixesToRemove = [
    "-fp8",
    "-gptq",
    "-awq",
    "-gguf",
    "-int4",
    "-int8",
  ];

  for (const suffix of suffixesToRemove) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }

  return normalized;
};

export const matchingLLMModelCost = (
  model: string,
  llmModelCosts: MaybeStoredLLMModelCost[],
): MaybeStoredLLMModelCost | undefined => {
  const normalizedModel = normalizeModelName(model);

  const llmModelCost = llmModelCosts.find((llmModelCost) => {
    const regex = new RegExp(llmModelCost.regex);
    return regex.test(normalizedModel);
  });

  if (!llmModelCost && normalizedModel.includes("/")) {
    const model_ = normalizedModel.substring(
      normalizedModel.indexOf("/") + 1,
    );
    return matchingLLMModelCost(model_, llmModelCosts);
  }
  return llmModelCost;
};

export const getMatchingLLMModelCost = async (
  projectId: string,
  model: string,
) => {
  const llmModelCosts = await getLLMModelCosts({ projectId });
  return matchingLLMModelCost(model, llmModelCosts);
};

// Pre-warm most used models
export const prewarmTiktokenModels = async () => {
  await tiktokenClient.prewarm(["gpt-4", "gpt-4o"]);
};

if (isBuildOrNoRedis) {
  prewarmTiktokenModels().catch((error) => {
    logger.error({ error }, "error prewarming tiktoken models");
  });
}
