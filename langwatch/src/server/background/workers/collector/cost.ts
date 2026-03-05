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
    ? llmModelCost.model.split("/")[1]!
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

export const matchingLLMModelCost = (
  model: string,
  llmModelCosts: MaybeStoredLLMModelCost[],
): MaybeStoredLLMModelCost | undefined => {
  const llmModelCost = llmModelCosts.find((llmModelCost) =>
    new RegExp(llmModelCost.regex).test(model),
  );
  if (!llmModelCost && model.includes("/")) {
    const model_ = model.split("/")[1]!;
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
