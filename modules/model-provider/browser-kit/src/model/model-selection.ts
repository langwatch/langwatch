/** Which models a picker offers, from the providers a project has stored. Pure: consumers fetch. */
import {
  allLitellmModels,
  buildCustomModelDisplayNames,
  isCodexModel,
  isModelAllowedForFeature,
  modelDisplayLabel,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import type React from "react";

import { modelProviderIcons } from "../provider-icons.ts";
import type { ModelOption } from "./model-options.ts";

export type ModelOptionGroup = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
};

export type GroupedModelOptions = ModelOptionGroup[];

/**
 * Fail-closed gate for restricted-provider models (codex today): a picker
 * only offers them when it declares a licensed `featureKey`. Exported for tests.
 */
export const filterRestrictedModels = ({
  models,
  featureKey,
}: {
  models: string[];
  featureKey?: string | undefined;
}): string[] =>
  models.filter((model) =>
    featureKey === undefined
      ? !isCodexModel(model)
      : isModelAllowedForFeature({ modelId: model, featureKey }),
  );

const SCOPE_RANK = { PROJECT: 3, TEAM: 2, ORGANIZATION: 1 } as const;
const scopeRank = (scopeType?: string): number =>
  SCOPE_RANK[scopeType as keyof typeof SCOPE_RANK] ?? 0;

/**
 * Provider keys whose registry models in `mode` must not be offered, because the row
 * `resolveServingRow` actually picks (its scope-collapse winner, not the union of rows) cannot
 * serve them.
 */
export const providersWithoutRegistryModels = (
  rows: {
    provider: string;
    enabled: boolean;
    scopeType?: string | undefined;
    embeddingsUnsupported?: boolean | undefined;
  }[],
  mode: "chat" | "embedding",
): Set<string> => {
  const unavailable = new Set<string>();
  if (mode !== "embedding") return unavailable;

  const byProvider = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.enabled) continue;
    const group = byProvider.get(row.provider);
    if (group) {
      group.push(row);
    } else {
      byProvider.set(row.provider, [row]);
    }
  }

  for (const [provider, group] of byProvider) {
    const topTier = Math.max(...group.map((r) => scopeRank(r.scopeType)));
    const contenders = group.filter((r) => scopeRank(r.scopeType) === topTier);
    if (contenders.some((r) => r.embeddingsUnsupported)) {
      unavailable.add(provider);
    }
  }
  return unavailable;
};

/**
 * A real union by model id: the first row that declares a model wins.
 * Concatenating instead put one model in the picker twice.
 */
const unionCustomModels = <T extends { modelId: string }>(
  first: readonly T[] | null | undefined,
  second: readonly T[] | null | undefined,
): T[] => {
  const byModelId = new Map<string, T>();
  for (const model of [...(first ?? []), ...(second ?? [])]) {
    if (!byModelId.has(model.modelId)) byModelId.set(model.modelId, model);
  }
  return [...byModelId.values()];
};

/**
 * Adapt the array shape into the legacy `Record<provider, config>` shape
 * `getCustomModels` expects, merging multi-scope rows (enabled if any is,
 * custom model lists union).
 */
const mergeProviderRowsByKey = (
  rows: readonly MaybeStoredModelProvider[],
): Record<string, MaybeStoredModelProvider> => {
  const byKey: Record<string, MaybeStoredModelProvider> = {};
  for (const row of rows) {
    const existing = byKey[row.provider];
    if (!existing) {
      byKey[row.provider] = row;
      continue;
    }
    byKey[row.provider] = {
      ...existing,
      enabled: existing.enabled || row.enabled,
      customModels: unionCustomModels(existing.customModels, row.customModels),
      customEmbeddingsModels: unionCustomModels(
        existing.customEmbeddingsModels,
        row.customEmbeddingsModels,
      ),
    };
  }
  return byKey;
};

/** Custom model ids across every provider row, whether or not the row is enabled. */
const allCustomModelIds = (
  providersByKey: Record<string, MaybeStoredModelProvider>,
  mode: "chat" | "embedding",
): Set<string> => {
  const ids = new Set<string>();
  for (const [providerKey, config] of Object.entries(providersByKey)) {
    const customList = mode === "chat" ? config.customModels : config.customEmbeddingsModels;
    for (const model of customList ?? []) ids.add(`${providerKey}/${model.modelId}`);
  }

  return ids;
};

/** One group per provider, custom models at the top of each. */
const groupOptionsByProvider = (selectOptions: ModelOption[]): GroupedModelOptions => {
  const byProvider: Record<string, ModelOption[]> = {};
  for (const option of selectOptions) {
    const provider = option.value.split("/")[0]!;
    byProvider[provider] ??= [];
    byProvider[provider].push(option);
  }

  return Object.entries(byProvider).map(([provider, models]) => ({
    provider,
    icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
    models: [...models.filter((m) => m.isCustom), ...models.filter((m) => !m.isCustom)],
  }));
};

/** Every custom model id an enabled provider declares for this mode. */
const enabledCustomModelIds = (
  modelProviders: Record<string, MaybeStoredModelProvider>,
  mode: "chat" | "embedding",
): string[] => {
  const ids: string[] = [];
  for (const [providerKey, config] of Object.entries(modelProviders)) {
    if (!config.enabled) continue;

    const customList = mode === "chat" ? config.customModels : config.customEmbeddingsModels;
    for (const model of customList ?? []) ids.push(`${providerKey}/${model.modelId}`);
  }

  return ids;
};

/** Combines registry models (`options`, filtered by `mode`) with custom models, custom first. */
export const getCustomModels = (
  modelProviders: Record<string, MaybeStoredModelProvider>,
  options: string[],
  mode: "chat" | "embedding" = "chat",
): string[] => {
  const customModelIds = enabledCustomModelIds(modelProviders, mode);
  const registryModelIds: string[] = [];
  const customSet = new Set(customModelIds);

  // Include registry models from enabled providers, filtered by mode
  for (const option of options) {
    const provider = option.split("/")[0]!;
    if (!modelProviders[provider]?.enabled) continue;

    const registryMode = allLitellmModels[option]?.mode;
    if (registryMode && registryMode !== mode) continue;

    // Skip if already added as a custom model (same ID)
    if (customSet.has(option)) continue;

    registryModelIds.push(option);
  }

  return [...customModelIds, ...registryModelIds];
};

/** The picker's options for `mode`, flat and grouped by provider, custom models first. */
export function modelSelectionFrom({
  providers,
  options,
  mode,
  featureKey,
}: {
  providers: readonly MaybeStoredModelProvider[];
  options: string[];
  mode: "chat" | "embedding";
  featureKey: string | undefined;
}): { selectOptions: ModelOption[]; groupedByProvider: GroupedModelOptions } {
  const providersByKey = mergeProviderRowsByKey(providers);
  const customModelIdSet = allCustomModelIds(providersByKey, mode);
  // Gemini's Agent Platform door serves chat but not embeddings (404 on :batchEmbedContents),
  // so registry embedding models are dropped; explicit custom models stay.
  const withoutRegistryModels = providersWithoutRegistryModels([...providers], mode);
  const allModels = filterRestrictedModels({
    models: getCustomModels(providersByKey, options, mode),
    featureKey,
  }).filter(
    (model) => customModelIdSet.has(model) || !withoutRegistryModels.has(model.split("/")[0]!),
  );
  const displayNames = buildCustomModelDisplayNames([...providers]);
  const selectOptions: ModelOption[] = allModels.map((modelValue) => ({
    label: modelDisplayLabel({ fullModelId: modelValue, displayNames }),
    value: modelValue,
    icon: modelProviderIcons[modelValue.split("/")[0]! as keyof typeof modelProviderIcons],
    isDisabled: false,
    mode,
    isCustom: customModelIdSet.has(modelValue),
  }));
  return { selectOptions, groupedByProvider: groupOptionsByProvider(selectOptions) };
}
