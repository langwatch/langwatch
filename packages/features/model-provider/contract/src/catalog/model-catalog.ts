/**
 * Single source of truth for the model catalog. Merges the base
 * `llmModels.json`, regenerated weekly from the upstream price sources, with
 * the hand-curated `llmModels.overlay.json`.
 *
 * Merge rule: the overlay wins on key collision. It is the correction lane,
 * so a hand-written rate has to be able to override a wrong generated one.
 * The rule used to be the other way around, which made the overlay unable to
 * do the one job it existed for: an upstream source that carries a model at
 * the wrong price shadowed the hand-written fix, and no comment in the
 * overlay could change that. It went unnoticed for as long as every overlay
 * entry happened to be a model the base file did not carry.
 *
 * The cost of this direction is that a stale overlay entry now overrides a
 * corrected upstream price instead of quietly losing to it. That is why the
 * weekly sync audits every overlay entry against upstream and fails on a
 * disagreement it has not already accepted: an override has to keep earning
 * its place. Never take the audit out and leave this merge order in.
 *
 * The regen task never writes the overlay file. Keep it that way.
 */
import { z } from "zod";
import llmModelsRaw from "./model-catalog.json";
import llmModelsOverlayRaw from "./model-catalog.overlay.json";
import type { LLMModelEntry, LLMModelRegistry } from "./model-catalog.types";

export const modelPricingSchema = z
  .object({
    inputCostPerToken: z.number(),
    outputCostPerToken: z.number(),
    inputCacheReadPerToken: z.number().optional(),
    inputCacheWritePerToken: z.number().optional(),
    inputCacheWrite1hPerToken: z.number().optional(),
    imageCostPerToken: z.number().optional(),
    imageOutputCostPerToken: z.number().optional(),
    audioCostPerToken: z.number().optional(),
    audioOutputCostPerToken: z.number().optional(),
    internalReasoningCostPerToken: z.number().optional(),
    webSearchCostPerQuery: z.number().optional(),
    inputCostPerCharacter: z.number().optional(),
    inputCostPerSecond: z.number().optional(),
  })
  .strict();

export const modelCatalogEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    provider: z.string(),
    pricing: modelPricingSchema,
    contextLength: z.number(),
    maxCompletionTokens: z.number().nullable(),
    supportedParameters: z.array(z.string()),
    defaultParameters: z.record(z.string(), z.unknown()).nullable(),
    modality: z.string(),
    mode: z.enum(["chat", "embedding", "audio"]),
    description: z.string().optional(),
    supportsImageInput: z.boolean(),
    supportsAudioInput: z.boolean(),
    supportsImageOutput: z.boolean(),
    supportsAudioOutput: z.boolean(),
    reasoningConfig: z
      .object({
        supported: z.boolean(),
        parameterName: z.string(),
        allowedValues: z.array(z.enum(["none", "low", "medium", "high", "xhigh"])),
        defaultValue: z.enum(["none", "low", "medium", "high", "xhigh"]),
        canDisable: z.boolean(),
      })
      .optional(),
  })
  .strict();

const modelCatalogSchema = z
  .object({
    updatedAt: z.string(),
    modelCount: z.number(),
    models: z.record(z.string(), modelCatalogEntrySchema),
  })
  .strict();

const modelCatalogOverlaySchema = z
  .object({ models: z.record(z.string(), modelCatalogEntrySchema) })
  .loose();

const base: LLMModelRegistry = modelCatalogSchema.parse(llmModelsRaw);
const overlay = modelCatalogOverlaySchema.parse(llmModelsOverlayRaw);

export const baseModelCatalog = base;
export const overlayModelCatalog = overlay;

// Base first, overlay second so the hand-written correction wins.
const mergedModels: Record<string, LLMModelEntry> = {
  ...base.models,
  ...overlay.models,
};

/** Merged model catalog ready for callers. Same shape as the base
 *  `llmModels.json` but with overlay entries folded in. */
export const llmModels: LLMModelRegistry = {
  updatedAt: base.updatedAt,
  modelCount: Object.keys(mergedModels).length,
  models: mergedModels,
};

export function getModelMetadata(modelId: string): {
  supportedParameters: string[];
  contextLength: number;
  maxCompletionTokens: number | null;
  defaultParameters: Record<string, unknown> | null;
  pricing: LLMModelEntry["pricing"];
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
} | null {
  const model = llmModels.models[modelId];
  if (model === undefined) {
    return null;
  }

  return {
    supportedParameters: model.supportedParameters,
    contextLength: model.contextLength,
    maxCompletionTokens: model.maxCompletionTokens,
    defaultParameters: model.defaultParameters,
    pricing: model.pricing,
    supportsImageInput: model.supportsImageInput,
    supportsAudioInput: model.supportsAudioInput,
  };
}

export function getAllModels(): Record<string, LLMModelEntry> {
  return llmModels.models;
}

export function getModelById(modelId: string): LLMModelEntry | undefined {
  return llmModels.models[modelId];
}

export function getProviderModelOptions(
  provider: string,
  mode: "chat" | "embedding",
): Array<{ value: string; label: string }> {
  return Object.values(llmModels.models)
    .filter((model) => model.provider === provider && model.mode === mode)
    .map((model) => {
      const value = model.id.split("/").slice(1).join("/");
      return { value, label: value };
    });
}

export function getModelsForProvider(provider: string): LLMModelEntry[] {
  return Object.values(llmModels.models).filter((model) => model.provider === provider);
}

export function getAllProviders(): string[] {
  const providers = new Set(
    Object.values(llmModels.models).map((model) => model.provider),
  );
  return [...providers].sort();
}

export function getRegistryMetadata(): { updatedAt: string; modelCount: number } {
  return { updatedAt: llmModels.updatedAt, modelCount: llmModels.modelCount };
}

export const knownVariantSuffixes = ["free", "thinking", "extended", "beta"] as const;

export function hasVariantSuffix(modelId: string): boolean {
  const colonIndex = modelId.lastIndexOf(":");
  if (colonIndex === -1) {
    return false;
  }

  const suffix = modelId.slice(colonIndex + 1);
  if (/^\d+$/.test(suffix)) {
    return false;
  }

  return knownVariantSuffixes.includes(
    suffix.toLowerCase() as (typeof knownVariantSuffixes)[number],
  );
}

export const allLitellmModels: Record<string, { mode: "chat" | "embedding" | "audio" }> =
  Object.fromEntries(
    Object.entries(llmModels.models)
      .filter(([id]) => !hasVariantSuffix(id))
      .map(([id, model]) => [id, { mode: model.mode }]),
  );

/** Ids the overlay overrides in the base catalog. The weekly price audit
 *  reports these so an override that is no longer needed gets retired. */
export const overlayOverriddenModelIds: string[] = Object.keys(overlay.models)
  .filter((id) => id in base.models)
  .sort();
