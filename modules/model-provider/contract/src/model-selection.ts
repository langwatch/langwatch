/** Which models a picker offers, from the providers a project has stored. Pure: consumers fetch. */
import { isCodexModel, isModelAllowedForFeature } from "./catalog/codex-restrictions.ts";
import { allLitellmModels } from "./catalog/model-catalog.ts";
import { allModelOptions, type ModelOption } from "./model-options.ts";
import { buildCustomModelDisplayNames, modelDisplayLabel } from "./model-provider-display-names.ts";
import type { ModelProviderEditorValue as MaybeStoredModelProvider } from "./model-provider-registry.ts";
import type { ModelProviderSummary } from "./model-provider.ts";

export type ModelOptionGroup = {
  provider: string;
  /** The group's heading when it is not the provider's own name. */
  label?: string;
  models: ModelOption[];
};

/**
 * A model LangWatch serves itself, so a project needs no provider of its own to pick it.
 * `isOffered: false` keeps it out of the options while a saved choice still reads by its label.
 */
export type BuiltInModel = { value: string; label: string; isOffered?: boolean };

/** The heading built-in models are listed under. */
export const BUILT_IN_MODELS_GROUP_LABEL = "LangWatch";

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

/**
 * The picker's options for `mode`, flat and grouped by provider, custom models first.
 * Built-in models come before every provider's, under their own heading.
 */
export function modelSelectionFrom({
  providers,
  options,
  mode,
  featureKey,
  builtInModels = [],
}: {
  providers: readonly MaybeStoredModelProvider[];
  options: string[];
  mode: "chat" | "embedding";
  featureKey: string | undefined;
  builtInModels?: readonly BuiltInModel[];
}): {
  selectOptions: ModelOption[];
  groupedByProvider: GroupedModelOptions;
  labelledOptions: ModelOption[];
} {
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
    isDisabled: false,
    mode,
    isCustom: customModelIdSet.has(modelValue),
  }));
  const toOption = ({ value, label }: BuiltInModel): ModelOption => ({
    label,
    value,
    isDisabled: false,
    mode,
  });
  const builtInOptions = builtInModels.filter((model) => model.isOffered !== false).map(toOption);
  const labelledOptions = builtInModels.filter((model) => model.isOffered === false).map(toOption);
  const builtInGroups: GroupedModelOptions = builtInOptions.map((option) => ({
    provider: option.value.split("/")[0]!,
    label: BUILT_IN_MODELS_GROUP_LABEL,
    models: [option],
  }));
  return {
    selectOptions: [...builtInOptions, ...selectOptions],
    groupedByProvider: [...mergeGroups(builtInGroups), ...groupOptionsByProvider(selectOptions)],
    labelledOptions,
  };
}

/** Built-in models sharing a provider prefix read as one group. */
function mergeGroups(groups: GroupedModelOptions): GroupedModelOptions {
  const byProvider = new Map<string, ModelOptionGroup>();
  for (const group of groups) {
    const existing = byProvider.get(group.provider);
    if (existing) existing.models.push(...group.models);
    else byProvider.set(group.provider, { ...group, models: [...group.models] });
  }
  return [...byProvider.values()];
}

/**
 * Whether the providers offer any chat model a picker with no feature restriction would
 * list, read off server summaries the way the browser reads its provider rows.
 */
export function hasPickableChatModel(
  providers: readonly Pick<ModelProviderSummary, "provider" | "enabled" | "customModels">[],
): boolean {
  const rows = providers.map((provider) => ({
    provider: provider.provider,
    enabled: provider.enabled,
    customModels: provider.customModels.map((model) => ({
      modelId: model.id,
      displayName: model.label,
      mode: "chat" as const,
    })),
  }));
  const { selectOptions } = modelSelectionFrom({
    providers: rows,
    options: allModelOptions,
    mode: "chat",
    featureKey: undefined,
  });
  return selectOptions.length > 0;
}
