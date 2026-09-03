import { createLogger } from "@langwatch/observability";
import { TiktokenClient } from "~/server/app-layer/clients/tokenizer/tiktoken.client";
import { compileSafeRegex } from "../../../utils/safeRegex";
import {
  getLLMModelCosts,
  type MaybeStoredLLMModelCost,
} from "../../modelProviders/llmModelCost";

const logger = createLogger("langwatch:tracer:collector:cost");

const tiktokenClient = new TiktokenClient();

export function estimateCost({
  llmModelCost,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  cacheCreation1hTokens,
  inputAudioTokens,
  outputAudioTokens,
  inputImageTokens,
  outputImageTokens,
  inputCharacters,
  audioSeconds,
}: {
  llmModelCost: MaybeStoredLLMModelCost;
  inputTokens?: number;
  outputTokens?: number;
  // Prompt-cache token counts, billed at their own rates. These are
  // SEPARATE from `inputTokens` (the non-cached input) — the caller must
  // pass the exclusive split, matching the Anthropic-native convention the
  // gateway emits (input_tokens excludes cache read/write). When a rate is
  // missing, that bucket falls back to the input rate so a cached request
  // is never costed as free.
  cacheReadTokens?: number;
  // Every token written to the cache, however long the entry lives.
  cacheCreationTokens?: number;
  // The portion of those writes that bought an hour-long entry rather than a
  // short-lived one, billed higher (Anthropic: 2x input against 1.25x). Only
  // emitters that know the split report it; without it every write is priced
  // at the short-lived rate, which is what the whole cost path did before this
  // bucket existed.
  cacheCreation1hTokens?: number;
  // Audio tokens, billed several times above text tokens: OpenAI charges $32
  // per million audio input tokens against $4 for text on gpt-realtime, and
  // twice the audio input rate for audio output. These are SEPARATE from
  // `inputTokens` / `outputTokens` — the caller passes the disjoint split, so
  // each token prices once. A model that declares no audio rate prices them
  // at its text rate, which makes a split payload cost exactly what the flat
  // total did.
  inputAudioTokens?: number;
  outputAudioTokens?: number;
  // Image tokens, billed at their own rates by the token-priced image
  // models: OpenAI charges $30 to $40 per million output image tokens on
  // gpt-image against $5 for text input. These are DISJOINT from
  // `inputTokens` / `outputTokens`, the same exclusive split as the audio
  // buckets, so each token prices once. There is no text fallback: a model
  // with no image rate prices image tokens at zero.
  inputImageTokens?: number;
  outputImageTokens?: number;
  // Audio usage: characters synthesized by TTS and seconds transcribed by
  // STT, billed at their own per-character / per-second rates. Sourced
  // from the gateway's gen_ai.usage.input_chars / gen_ai.usage.audio_seconds
  // span attributes.
  inputCharacters?: number;
  audioSeconds?: number;
}): number | undefined {
  // Undefined means "nothing here prices anything", which the caller reads as
  // an unpriced model rather than a free one. The cache rates count: a rule
  // that leaves input and output at zero and prices only cached tokens is
  // priced, and treating it as unpriced would silently drop its cost.
  const hasAnyRate =
    !!llmModelCost?.inputCostPerToken ||
    !!llmModelCost?.outputCostPerToken ||
    !!llmModelCost?.inputCostPerCharacter ||
    !!llmModelCost?.inputCostPerSecond ||
    !!llmModelCost?.cacheReadCostPerToken ||
    !!llmModelCost?.cacheCreationCostPerToken ||
    !!llmModelCost?.cacheCreation1hCostPerToken ||
    !!llmModelCost?.inputAudioCostPerToken ||
    !!llmModelCost?.outputAudioCostPerToken ||
    !!llmModelCost?.inputImageCostPerToken ||
    !!llmModelCost?.outputImageCostPerToken;
  if (!hasAnyRate) return undefined;

  const inputRate = llmModelCost.inputCostPerToken ?? 0;
  const outputRate = llmModelCost.outputCostPerToken ?? 0;
  // A model with no audio rate prices audio tokens at its text rate, so a
  // caller that starts reporting the split charges exactly what it charged
  // when it reported one flat total.
  const inputAudioRate = llmModelCost.inputAudioCostPerToken ?? inputRate;
  const outputAudioRate = llmModelCost.outputAudioCostPerToken ?? outputRate;
  const cacheReadRate = llmModelCost.cacheReadCostPerToken ?? inputRate;
  const cacheCreationRate = llmModelCost.cacheCreationCostPerToken ?? inputRate;
  // A model that never had the hour-long distinction prices both buckets the
  // same, so pricing is unchanged for it.
  const cacheCreation1hRate =
    llmModelCost.cacheCreation1hCostPerToken ?? cacheCreationRate;

  // The hour-long count is a subset of the total, but an emitter can report one
  // without the other, so take whichever is larger as the true total and price
  // the remainder short-lived. Clamping keeps a malformed pair (1h above the
  // total) from producing a negative charge.
  const cacheWrite1h = Math.max(0, cacheCreation1hTokens ?? 0);
  const cacheWriteTotal = Math.max(
    Math.max(0, cacheCreationTokens ?? 0),
    cacheWrite1h,
  );
  const cacheWriteCost =
    cacheWrite1h * cacheCreation1hRate +
    (cacheWriteTotal - cacheWrite1h) * cacheCreationRate;

  return (
    (inputTokens ?? 0) * inputRate +
    (outputTokens ?? 0) * outputRate +
    (inputAudioTokens ?? 0) * inputAudioRate +
    (outputAudioTokens ?? 0) * outputAudioRate +
    (inputImageTokens ?? 0) * (llmModelCost.inputImageCostPerToken ?? 0) +
    (outputImageTokens ?? 0) * (llmModelCost.outputImageCostPerToken ?? 0) +
    (cacheReadTokens ?? 0) * cacheReadRate +
    cacheWriteCost +
    (inputCharacters ?? 0) * (llmModelCost.inputCostPerCharacter ?? 0) +
    (audioSeconds ?? 0) * (llmModelCost.inputCostPerSecond ?? 0)
  );
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
 * The cost-rule preview feeds user keystrokes through the matcher, so the
 * pattern space is unbounded, reset the cache when it grows past any
 * plausible working set instead of leaking entries forever.
 */
const REGEX_CACHE_MAX_ENTRIES = 5_000;

/**
 * Returns a cached, safe-checked RegExp for the given pattern.
 * Unsafe or invalid patterns are cached as null and warned once.
 */
const getSafeRegex = (pattern: string): RegExp | null => {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;

  const re = compileSafeRegex(pattern);
  if (!re) {
    logger.warn({ pattern }, "skipping unsafe regex in model cost matching");
  }
  if (regexCache.size >= REGEX_CACHE_MAX_ENTRIES) {
    regexCache.clear();
  }
  regexCache.set(pattern, re);
  return re;
};

/**
 * Tests a regex pattern against a model string, skipping patterns
 * that are vulnerable to catastrophic backtracking (ReDoS).
 * Results are cached so each pattern is compiled and safety-checked only once.
 */
const safeRegexTest = (pattern: string, input: string): boolean => {
  const re = getSafeRegex(pattern);
  return re?.test(input) ?? false;
};

/**
 * Strips the provider subtype from a model string.
 * Example: "openai.responses/gpt-5-mini" → "openai/gpt-5-mini"
 */
export function stripProviderSubtype(model: string): string {
  const slashIdx = model.indexOf("/");
  if (slashIdx === -1) return model;
  const provider = model.slice(0, slashIdx);
  if (!provider.includes(".")) return model;
  return provider.split(".")[0] + model.slice(slashIdx);
}

/**
 * Normalize Bedrock-style model IDs into the `<vendor>/<model>` shape
 * the static registry uses. Bedrock identifies models as
 *   [<region>.]<vendor>.<model>[-v<N>][:<version>]
 * e.g. `eu.anthropic.claude-haiku-4-5-20251001-v1:0` →
 *      `anthropic/claude-haiku-4-5-20251001`
 * litellm-style clients report the same id behind a `bedrock/` provider
 * prefix (`bedrock/eu.anthropic.claude-sonnet-4-6`); that prefix is part
 * of the envelope and is stripped too. The registry regexes already match
 * dated Claude/Nova slugs, so stripping just the Bedrock envelope is enough.
 */
export function normalizeBedrockModelId(model: string): string {
  let normalized = model;
  // 0. Strip the litellm-style `bedrock/` provider prefix.
  normalized = normalized.replace(/^bedrock\//i, "");
  // 1. Strip `:<version>` suffix (`:0`, `:1`, `:latest`).
  normalized = normalized.replace(/:[0-9a-z.]+$/i, "");
  // 2. Strip `-v<N>` revision marker (`-v1`, `-v2`).
  normalized = normalized.replace(/-v\d+$/i, "");
  // 3. Strip cross-region inference prefix (`eu.`, `us.`, `apac.`,
  //    `ap.`, `eu-west-*.`, ...). Only the leading region segment;
  //    vendor segment keeps its own dots untouched.
  normalized = normalized.replace(
    /^[a-z]{2,}(?:-[a-z0-9]+)*\.(?=[a-z]+\.)/i,
    "",
  );
  // 4. Vendor-dot → vendor-slash. First dot only — any dots in the
  //    vendor-model half (e.g. `claude-opus-4.5`) stay.
  const firstDot = normalized.indexOf(".");
  if (firstDot > 0 && !normalized.slice(0, firstDot).includes("/")) {
    normalized =
      normalized.slice(0, firstDot) + "/" + normalized.slice(firstDot + 1);
  }
  return normalized;
}

/**
 * Matches a model string against cost entries with cascading fallbacks:
 * 1. Raw model string
 * 2. Strip provider subtype (openai.responses → openai)
 *
 * Date suffixes are handled by the prefix-match regex patterns in the
 * static model registry, so no explicit date stripping is needed.
 */
export const matchModelCostWithFallbacks = (
  model: string,
  costs: MaybeStoredLLMModelCost[],
): MaybeStoredLLMModelCost | undefined => {
  const match = matchingLLMModelCost(model, costs);
  if (match) return match;

  const strippedSubtype = stripProviderSubtype(model);
  if (strippedSubtype !== model) {
    const subtypeMatch = matchingLLMModelCost(strippedSubtype, costs);
    if (subtypeMatch) return subtypeMatch;
  }

  // Bedrock-shaped IDs (cross-region prefix + `-v<N>:0` suffix +
  // vendor-dot-model) don't match registry keys directly — fall back to
  // the normalized form so `eu.anthropic.claude-haiku-4-5-20251001-v1:0`
  // hits the `anthropic/claude-haiku-4.5` entry's regex.
  const normalizedBedrock = normalizeBedrockModelId(model);
  if (normalizedBedrock !== model) {
    return matchingLLMModelCost(normalizedBedrock, costs);
  }

  return undefined;
};

/** Low-level regex matcher — no date/subtype stripping. Use matchModelCostWithFallbacks. */
const matchingLLMModelCost = (
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
  return matchModelCostWithFallbacks(model, llmModelCosts);
};

// Pre-warm most used models. Invoked explicitly by the collector worker on
// startup (see collectorWorker.ts) — NOT as a module-load side effect. An
// eager import-time prewarm fired an un-awaited tiktoken BPE-rank fetch whose
// socket/WASM-load outlived vitest teardown, wedging the unit-test worker under
// --coverage and timing out CI (#4476). The worker owns the prewarm lifecycle.
export const prewarmTiktokenModels = async () => {
  await tiktokenClient.prewarm(["gpt-4", "gpt-4o"]);
};
