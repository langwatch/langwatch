import safe from "safe-regex2";
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

const VENDOR_MAPPINGS: Record<string, string> = {
  "deepseek-ai/": "deepseek/",
  "minimaxai/": "minimax/",
  "zai-org/": "z-ai/",
  "zhipu-ai/": "z-ai/",
};

const QUANTIZATION_SUFFIXES = [
  "-fp8",
  "-gptq",
  "-awq",
  "-gguf",
  "-int4",
  "-int8",
];

/**
 * Normalize model name for better matching:
 * - Convert to lowercase
 * - Normalize common vendor prefix variations
 * - Remove quantization variant suffixes (FP8, GPTQ, etc.)
 */
export const normalizeModelName = (model: string): string => {
  let normalized = model.toLowerCase();

  for (const [from, to] of Object.entries(VENDOR_MAPPINGS)) {
    if (normalized.startsWith(from)) {
      normalized = normalized.replace(from, to);
      break;
    }
  }

  for (const suffix of QUANTIZATION_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }

  return normalized;
};

/** Cache: pattern → compiled RegExp (safe) or null (unsafe/invalid). */
const regexCache = new Map<string, RegExp | null>();

/**
 * Returns a cached, safe-checked RegExp for the given pattern.
 * Unsafe or invalid patterns are cached as null and warned once.
 */
const getSafeRegex = (pattern: string): RegExp | null => {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;

  try {
    const re = new RegExp(pattern);
    if (!safe(re)) {
      logger.warn({ pattern }, "skipping unsafe regex in model cost matching");
      regexCache.set(pattern, null);
      return null;
    }
    regexCache.set(pattern, re);
    return re;
  } catch {
    regexCache.set(pattern, null);
    return null;
  }
};

/**
 * Tests a regex pattern against a model string, skipping patterns
 * that are vulnerable to catastrophic backtracking (ReDoS).
 * Results are cached so each pattern is compiled and safety-checked only once.
 */
const safeRegexTest = (pattern: string, input: string): boolean => {
  const re = getSafeRegex(pattern);
  return re !== null && re.test(input);
};

/**
 * Low-level model cost matcher — does NOT strip date suffixes or provider subtypes.
 * Use matchModelCostWithFallbacks() instead for production code.
 * @internal Exported only for dependency injection in span-cost-enrichment.service.ts
 */
export const matchingLLMModelCost = (
  model: string,
  llmModelCosts: MaybeStoredLLMModelCost[],
): MaybeStoredLLMModelCost | undefined => {
  // Try raw model string first so custom case-sensitive regexes work
  const rawMatch = findModelCost(model, llmModelCosts);
  if (rawMatch) return rawMatch;

  // Fall back to normalized form for built-in fuzzy matching
  const normalizedModel = normalizeModelName(model);
  if (normalizedModel !== model) {
    return findModelCost(normalizedModel, llmModelCosts);
  }
  return undefined;
};

const findModelCost = (
  model: string,
  llmModelCosts: MaybeStoredLLMModelCost[],
): MaybeStoredLLMModelCost | undefined => {
  const match = llmModelCosts.find((entry) =>
    safeRegexTest(entry.regex, model),
  );

  if (!match && model.includes("/")) {
    const stripped = model.substring(model.indexOf("/") + 1);
    return findModelCost(stripped, llmModelCosts);
  }
  return match;
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
