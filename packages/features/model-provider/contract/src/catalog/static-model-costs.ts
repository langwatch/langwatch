import type { ModelCostRate } from "../model-provider";
import { isCodexModel } from "./codex-restrictions";
import { llmModels } from "./model-catalog";

const ANTHROPIC_MODEL_ID = /^~?anthropic\//;
const OPENAI_AUDIO_MODEL_ID = /^~?openai\/(gpt-audio|gpt-realtime)/;

export function resolveCacheWrite1hRate(
  modelId: string,
  pricing: {
    inputCostPerToken?: number;
    inputCacheWritePerToken?: number;
    inputCacheWrite1hPerToken?: number;
  },
): number | undefined {
  if (pricing.inputCacheWrite1hPerToken != null) {
    return pricing.inputCacheWrite1hPerToken;
  }
  if (
    !ANTHROPIC_MODEL_ID.test(modelId) ||
    pricing.inputCacheWritePerToken == null ||
    pricing.inputCostPerToken == null
  ) {
    return void 0;
  }

  return pricing.inputCostPerToken * 2;
}

export function resolveAudioOutputRate(
  modelId: string,
  pricing: {
    audioCostPerToken?: number;
    audioOutputCostPerToken?: number;
  },
): number | undefined {
  if (pricing.audioOutputCostPerToken != null) {
    return pricing.audioOutputCostPerToken;
  }
  if (!OPENAI_AUDIO_MODEL_ID.test(modelId) || pricing.audioCostPerToken == null) {
    return void 0;
  }

  return pricing.audioCostPerToken * 2;
}

let cachedRates: readonly ModelCostRate[] | null = null;

export function getStaticModelCostRates(): readonly ModelCostRate[] {
  if (cachedRates) {
    return cachedRates;
  }

  const rates = Object.entries(llmModels.models)
    .flatMap(([modelId, model]): ModelCostRate[] => {
      if (isCodexModel(modelId) || !hasPrice(model.pricing)) {
        return [];
      }

      return [
        {
          model: modelId,
          regex: modelPattern(modelId),
          inputCostPerToken: model.pricing.inputCostPerToken ?? 0,
          outputCostPerToken: model.pricing.outputCostPerToken ?? 0,
          cacheReadCostPerToken: model.pricing.inputCacheReadPerToken,
          cacheCreationCostPerToken: model.pricing.inputCacheWritePerToken,
          cacheCreation1hCostPerToken: resolveCacheWrite1hRate(modelId, model.pricing),
          inputAudioCostPerToken: model.pricing.audioCostPerToken,
          outputAudioCostPerToken: resolveAudioOutputRate(modelId, model.pricing),
          inputCostPerCharacter: model.pricing.inputCostPerCharacter,
          inputCostPerSecond: model.pricing.inputCostPerSecond,
        },
      ];
    })
    .filter((rate, _index, all) => {
      const base = rate.model.split(":")[0];
      return !(
        rate.model.includes(":") &&
        base !== void 0 &&
        all.some((candidate) => candidate.model === base)
      );
    })
    .filter((rate) => !rate.model.includes("openrouter/"))
    .sort(compareSpecificity);

  cachedRates = rates;
  return cachedRates;
}

function hasPrice(pricing: {
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  inputCostPerCharacter?: number;
  inputCostPerSecond?: number;
  audioCostPerToken?: number;
}): boolean {
  return (
    pricing.inputCostPerToken != null ||
    pricing.outputCostPerToken != null ||
    pricing.inputCostPerCharacter != null ||
    pricing.inputCostPerSecond != null ||
    pricing.audioCostPerToken != null
  );
}

function modelPattern(modelId: string): string {
  const [vendor, ...modelParts] = modelId.split("/");
  const hasVendor = modelParts.length > 0;
  const modelName = hasVendor ? modelParts.join("/") : modelId;
  const escapedModel = escapeStringRegexp(modelName)
    .replaceAll("\\x2d", "-")
    .replaceAll("\\-", "-")
    .replace("vertex_ai", "(vertex_ai|vertexai)")
    .replaceAll("\\.", "[.-]")
    .replace(/(\d)-(\d)/g, "$1[.-]$2");
  if (!hasVendor || vendor === void 0) {
    return `^${escapedModel}`;
  }

  const escapedVendor = escapeStringRegexp(vendor).replaceAll("\\x2d", "-").replaceAll("\\-", "-");
  return `^(${escapedVendor}\\/)?${escapedModel}`;
}

function escapeStringRegexp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

function compareSpecificity(left: ModelCostRate, right: ModelCostRate): number {
  const leftKey = modelSpecificityKey(left.model);
  const rightKey = modelSpecificityKey(right.model);

  return (
    rightKey.length - leftKey.length ||
    Number(left.model.includes("/")) - Number(right.model.includes("/"))
  );
}

function modelSpecificityKey(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}
