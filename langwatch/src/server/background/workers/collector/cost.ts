import fs from "fs/promises";
import NodeFetchCache, { FileSystemCache } from "node-fetch-cache";
import path from "path";
import type { Tiktoken } from "tiktoken/lite";
// @ts-ignore
import models from "tiktoken/model_to_encoding.json";
// @ts-ignore
import registry from "tiktoken/registry.json";
import { createLogger } from "../../../../utils/logger/server";
import { startSpan } from "../../../../utils/posthogErrorCapture";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../../modelProviders/llmModelCost";
import { isBuildOrNoRedis } from "../../../redis";

const logger = createLogger("langwatch:workers:collector:cost");

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
  modelName: string,
): Promise<{ encoder: Tiktoken } | undefined> => {
  let Tiktoken: typeof import("tiktoken/lite").Tiktoken;
  let load: typeof import("tiktoken/load").load;
  try {
    Tiktoken = (await import("tiktoken/lite")).Tiktoken;
    load = (await import("tiktoken/load")).load;
  } catch (error) {
    logger.warn(
      { error },
      "tiktoken could not be loaded, skipping tokenization",
    );
    return undefined;
  }

  const fallback = "gpt-4o";
  const usingFallback = !(modelName in models);
  const tokenizer = usingFallback
    ? (models as any)[fallback]
    : (models as any)[modelName];

  const startedWaiting = Date.now();
  while (loadingModel.has(tokenizer)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() - startedWaiting > 10000) {
      logger.warn({ tokenizer }, "timeout waiting for tokenizer");
      loadingModel.delete(tokenizer);
      break;
    }
  }

  if (!cachedModel[tokenizer]) {
    logger.info(`loading tiktoken model ${tokenizer}`);
    loadingModel.add(tokenizer);
    const registryInfo = (registry as any)[tokenizer];
    const fetch = NodeFetchCache.create({
      cache: new FileSystemCache({
        cacheDirectory: "node_modules/.cache/tiktoken",
        ttl: 1000 * 60 * 60 * 24 * 365, // 1 year
      }),
    });

    const model = await load(registryInfo, async (url) => {
      const filename = path.basename(url);

      // Prevent directory traversal
      const isSafeFilename = /^[a-zA-Z0-9._-]+$/.test(filename);
      if (!isSafeFilename) {
        logger.warn(
          { filename },
          "Unsafe filename detected; using remote fetch instead",
        );
        return fetch(url).then((r) => r.text());
      }

      if (process.env.TIKTOKENS_PATH) {
        const localPath = path.join(process.env.TIKTOKENS_PATH, filename);
        logger.debug(
          { localPath },
          "Attempting to load tiktoken model from local file",
        );

        try {
          return await fs.readFile(localPath, "utf8");
        } catch (error) {
          logger.warn(
            {
              localPath,
              error: error instanceof Error ? error.message : String(error),
            },
            "Local read failed; falling back to remote fetch",
          );
        }
      }

      // Default: fetch from remote
      return fetch(url).then((r) => r.text());
    });

    const encoder = new Tiktoken(
      model.bpe_ranks,
      model.special_tokens,
      model.pat_str,
    );

    cachedModel[tokenizer] = { model, encoder };
    loadingModel.delete(tokenizer);
  }

  return cachedModel[tokenizer];
};

async function countTokens(
  llmModelCost: MaybeStoredLLMModelCost,
  text: string | undefined,
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
 * - Remove variant suffixes (FP8, GPTQ, etc.)
 */
const normalizeModelName = (model: string): string => {
  let normalized = model.toLowerCase();

  // Normalize vendor prefixes
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

  // Remove common variant suffixes
  const suffixesToRemove = [
    "-fp8",
    "-gptq",
    "-awq",
    "-gguf",
    "-int4",
    "-int8",
    "-turbo",
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
  // Normalize model name for better matching
  const normalizedModel = normalizeModelName(model);

  const llmModelCost = llmModelCosts.find((llmModelCost) => {
    const regex = new RegExp(llmModelCost.regex);
    return regex.test(normalizedModel);
  });

  if (!llmModelCost && normalizedModel.includes("/")) {
    const model_ = normalizedModel.substring(normalizedModel.indexOf("/") + 1);
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
  await initTikToken("gpt-4");
  await initTikToken("gpt-4o");
};

if (isBuildOrNoRedis) {
  prewarmTiktokenModels().catch((error) => {
    logger.error({ error }, "error prewarming tiktoken models");
  });
}
