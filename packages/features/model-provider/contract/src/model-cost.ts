import {
  modelCostEstimateInputSchema,
  type ModelCostEstimateInput,
  type ModelCostRate,
} from "./model-provider";
import safe from "safe-regex2";

const ATTR = {
  cacheReadTokens: "gen_ai.usage.cache_read.input_tokens",
  cacheCreationTokens: "gen_ai.usage.cache_creation.input_tokens",
  cacheCreation1hTokens: "gen_ai.usage.cache_creation_1h.input_tokens",
  inputCharacters: "gen_ai.usage.input_chars",
  audioSeconds: "gen_ai.usage.audio_seconds",
  inputAudioTokens: "gen_ai.usage.input_audio_tokens",
  outputAudioTokens: "gen_ai.usage.output_audio_tokens",
  customInputRate: "langwatch.model.inputCostPerToken",
  customOutputRate: "langwatch.model.outputCostPerToken",
  customCacheReadRate: "langwatch.model.cacheReadCostPerToken",
  customCacheCreationRate: "langwatch.model.cacheCreationCostPerToken",
  customCacheCreation1hRate: "langwatch.model.cacheCreation1hCostPerToken",
  explicitCost: "langwatch.span.cost",
  responseModel: "gen_ai.response.model",
  requestModel: "gen_ai.request.model",
  spanType: "langwatch.span.type",
  output: "langwatch.output",
} as const;

const coerceToNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One observed invocation priced under ONE rate.
 *
 * Exported because the cost-rule preview prices its sample spans under the
 * rate a customer is still typing, which has no catalogue entry to look up.
 * A second implementation of this arithmetic would show a customer a price
 * their rule does not actually charge.
 */
export const estimateCost = (input: {
  rate: ModelCostRate;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheCreation1hTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  inputCharacters?: number;
  audioSeconds?: number;
}): number | undefined => {
  const rate = input.rate;
  const hasAnyRate =
    !!rate.inputCostPerToken ||
    !!rate.outputCostPerToken ||
    !!rate.inputCostPerCharacter ||
    !!rate.inputCostPerSecond ||
    !!rate.cacheReadCostPerToken ||
    !!rate.cacheCreationCostPerToken ||
    !!rate.cacheCreation1hCostPerToken ||
    !!rate.inputAudioCostPerToken ||
    !!rate.outputAudioCostPerToken;
  if (!hasAnyRate) return undefined;

  const inputRate = rate.inputCostPerToken ?? 0;
  const outputRate = rate.outputCostPerToken ?? 0;
  const inputAudioRate = rate.inputAudioCostPerToken ?? inputRate;
  const outputAudioRate = rate.outputAudioCostPerToken ?? outputRate;
  const cacheReadRate = rate.cacheReadCostPerToken ?? inputRate;
  const cacheCreationRate = rate.cacheCreationCostPerToken ?? inputRate;
  const cacheCreation1hRate = rate.cacheCreation1hCostPerToken ?? cacheCreationRate;
  const cacheWrite1h = Math.max(0, input.cacheCreation1hTokens);
  const cacheWriteTotal = Math.max(Math.max(0, input.cacheCreationTokens), cacheWrite1h);

  return (
    input.inputTokens * inputRate +
    input.outputTokens * outputRate +
    input.inputAudioTokens * inputAudioRate +
    input.outputAudioTokens * outputAudioRate +
    input.cacheReadTokens * cacheReadRate +
    cacheWrite1h * cacheCreation1hRate +
    (cacheWriteTotal - cacheWrite1h) * cacheCreationRate +
    (input.inputCharacters ?? 0) * (rate.inputCostPerCharacter ?? 0) +
    (input.audioSeconds ?? 0) * (rate.inputCostPerSecond ?? 0)
  );
};

export const normalizeModelName = (model: string): string => {
  let normalized = model.toLowerCase();
  for (const [from, to] of Object.entries({
    "deepseek-ai/": "deepseek/",
    "minimaxai/": "minimax/",
    "zai-org/": "z-ai/",
    "zhipu-ai/": "z-ai/",
  })) {
    if (normalized.startsWith(from)) {
      normalized = normalized.replace(from, to);
      break;
    }
  }
  for (const suffix of ["-fp8", "-gptq", "-awq", "-gguf", "-int4", "-int8"]) {
    if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length);
  }
  return normalized;
};

const regexCache = new Map<string, RegExp | null>();
const REGEX_CACHE_MAX_ENTRIES = 5_000;

const tryRegex = (pattern: string): RegExp | null => {
  const cached = regexCache.get(pattern);
  if (cached !== undefined) return cached;

  let compiled: RegExp | null;
  try {
    const regex = new RegExp(pattern);
    compiled = safe(regex) ? regex : null;
  } catch {
    compiled = null;
  }
  if (regexCache.size >= REGEX_CACHE_MAX_ENTRIES) regexCache.clear();
  regexCache.set(pattern, compiled);
  return compiled;
};

const findModelCost = (
  model: string,
  costs: readonly ModelCostRate[],
): ModelCostRate | undefined => {
  const matched = costs.find((cost) => tryRegex(cost.regex)?.test(model));
  if (matched) return matched;
  if (model.includes("/"))
    return findModelCost(model.slice(model.indexOf("/") + 1), costs);
  return undefined;
};

export const normalizeBedrockModelId = (model: string): string => {
  let normalized = model.replace(/^bedrock\//i, "");
  normalized = normalized.replace(/:[0-9a-z.]+$/i, "");
  normalized = normalized.replace(/-v\d+$/i, "");
  normalized = normalized.replace(/^[a-z]{2,}(?:-[a-z0-9]+)*\.(?=[a-z]+\.)/i, "");
  const firstDot = normalized.indexOf(".");
  if (firstDot > 0 && !normalized.slice(0, firstDot).includes("/")) {
    normalized = normalized.slice(0, firstDot) + "/" + normalized.slice(firstDot + 1);
  }
  return normalized;
};

/**
 * The one model-name matching cascade: raw, then normalized, then with the
 * provider subtype stripped, then with a Bedrock envelope normalized away —
 * each of those four candidates first as given and then normalized, and each
 * lookup falling back through `/`-separated prefixes.
 *
 * Exported because record-time cost enrichment matches the OPERATOR'S OWN cost
 * rules with it, not the static catalog `estimateModelCost` reads. Those rules
 * are regexes a customer wrote, stored per project, team or organization, and
 * the order the candidates are tried in decides which rule wins when two match.
 * A second implementation of this cascade would bill a span at a different
 * rate than the fold projection prices it, with nothing anywhere to show that
 * the two disagreed — so there is one, and both callers use it.
 */
export const matchModelCost = (
  model: string,
  costs: readonly ModelCostRate[],
): ModelCostRate | undefined => {
  const matching = (candidate: string): ModelCostRate | undefined => {
    const raw = findModelCost(candidate, costs);
    if (raw) return raw;
    const normalized = normalizeModelName(candidate);
    return normalized === candidate ? undefined : findModelCost(normalized, costs);
  };
  const raw = matching(model);
  if (raw) return raw;
  const slash = model.indexOf("/");
  const provider = slash === -1 ? undefined : model.slice(0, slash);
  if (provider?.includes(".")) {
    const strippedSubtype = provider.split(".")[0] + model.slice(slash);
    const subtypeMatch = matching(strippedSubtype);
    if (subtypeMatch) return subtypeMatch;
  }
  const bedrock = normalizeBedrockModelId(model);
  return bedrock === model ? undefined : matching(bedrock);
};

/**
 * The one canonical priority cascade used by every model-priced span.
 * Custom rates arrive as immutable span attributes, while platform rates come
 * from the Model Provider catalog passed by the owning service.
 */
export const estimateModelCost = (
  input: ModelCostEstimateInput,
  staticCosts: readonly ModelCostRate[],
): number => {
  const parsed = modelCostEstimateInputSchema.parse(input);
  const attrs = parsed.attrs;
  const inputTokens = parsed.promptTokens ?? 0;
  const outputTokens = parsed.completionTokens ?? 0;
  const cacheReadTokens = Math.max(0, coerceToNumber(attrs[ATTR.cacheReadTokens]) ?? 0);
  const cacheCreationTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR.cacheCreationTokens]) ?? 0,
  );
  const cacheCreation1hTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR.cacheCreation1hTokens]) ?? 0,
  );
  const inputCharacters = Math.max(0, coerceToNumber(attrs[ATTR.inputCharacters]) ?? 0);
  const audioSeconds = Math.max(0, coerceToNumber(attrs[ATTR.audioSeconds]) ?? 0);
  const inputAudioTokens = Math.max(0, coerceToNumber(attrs[ATTR.inputAudioTokens]) ?? 0);
  const outputAudioTokens = Math.max(
    0,
    coerceToNumber(attrs[ATTR.outputAudioTokens]) ?? 0,
  );

  const customInputRate = coerceToNumber(attrs[ATTR.customInputRate]);
  const customOutputRate = coerceToNumber(attrs[ATTR.customOutputRate]);
  if (customInputRate !== null || customOutputRate !== null) {
    return (
      estimateCost({
        rate: {
          model: "",
          regex: "",
          inputCostPerToken: customInputRate ?? 0,
          outputCostPerToken: customOutputRate ?? 0,
          cacheReadCostPerToken:
            coerceToNumber(attrs[ATTR.customCacheReadRate]) ?? undefined,
          cacheCreationCostPerToken:
            coerceToNumber(attrs[ATTR.customCacheCreationRate]) ?? undefined,
          cacheCreation1hCostPerToken:
            coerceToNumber(attrs[ATTR.customCacheCreation1hRate]) ?? undefined,
        },
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cacheCreation1hTokens,
        inputAudioTokens,
        outputAudioTokens,
      }) ?? 0
    );
  }

  const explicitCost = coerceToNumber(attrs[ATTR.explicitCost]);
  if (explicitCost !== null && explicitCost > 0) return explicitCost;

  const responseModel = attrs[ATTR.responseModel];
  const requestModel = attrs[ATTR.requestModel];
  const resolvedModel =
    parsed.model ??
    (typeof responseModel === "string" ? responseModel : undefined) ??
    (typeof requestModel === "string" ? requestModel : undefined);
  const hasUsage =
    inputTokens > 0 ||
    outputTokens > 0 ||
    cacheReadTokens > 0 ||
    cacheCreationTokens > 0 ||
    cacheCreation1hTokens > 0 ||
    inputCharacters > 0 ||
    audioSeconds > 0 ||
    inputAudioTokens > 0 ||
    outputAudioTokens > 0;
  if (resolvedModel && hasUsage) {
    const matched = matchModelCost(resolvedModel, staticCosts);
    if (matched) {
      const computed = estimateCost({
        rate: matched,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cacheCreation1hTokens,
        inputAudioTokens,
        outputAudioTokens,
        inputCharacters,
        audioSeconds,
      });
      if (computed !== undefined && computed > 0) return computed;
    }
  }

  if (attrs[ATTR.spanType] === "guardrail") {
    const output = attrs[ATTR.output];
    if (isRecord(output)) {
      const value = output.cost;
      if (isRecord(value)) {
        const amount = value.amount;
        const currency = value.currency;
        if (currency === "USD" && typeof amount === "number" && amount > 0) return amount;
      }
    }
  }

  return 0;
};
