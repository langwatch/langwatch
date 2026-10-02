import {
  allLitellmModels,
  buildCustomModelDisplayNames,
  isCodexModel,
  isModelAllowedForFeature,
  modelDisplayLabel,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import type React from "react";
import { useMemo } from "react";
import { modelProviderIcons } from "@langwatch/design-system/provider-icons";

import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
  isCustom?: boolean;
};

export type ModelOptionGroup = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
};

export type GroupedModelOptions = ModelOptionGroup[];

/**
 * Fail-closed gate for restricted-provider models (codex today): a picker
 * only offers them when it declares a `featureKey` AND that feature is
 * licensed to run them. Exported for tests.
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
 * Provider keys whose registry models in `mode` must not be offered, because
 * the row `resolveServingRow` picks (enabled beats disabled, then narrowest
 * scope) cannot serve them - a broader-scope row does not rescue it. Exported for tests.
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
 * A real union by model id: the first row that declares a model wins; the
 * same model at a wider scope adds nothing. Concatenating instead put one
 * model in the picker twice.
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
 * Adapts the array shape (one row per provider+scope) into the legacy
 * `Record<provider, config>` shape getCustomModels expects. Multi-scope rows
 * merge: enabled if any row is, custom model lists union.
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

/** Each provider's custom model ids for `mode`, as `<provider>/<modelId>`. */
function listCustomModelIds({
  modelProviders,
  mode,
  enabledOnly,
}: {
  modelProviders: Record<string, MaybeStoredModelProvider>;
  mode: "chat" | "embedding";
  enabledOnly: boolean;
}): string[] {
  return Object.entries(modelProviders).flatMap(([providerKey, config]) => {
    if (enabledOnly && !config.enabled) return [];
    const customList = mode === "chat" ? config.customModels : config.customEmbeddingsModels;
    return (customList ?? []).map((model) => `${providerKey}/${model.modelId}`);
  });
}

/** Options keyed by provider, in the order they arrive. */
function groupOptionsByProvider(options: ModelOption[]): Record<string, ModelOption[]> {
  const byProvider: Record<string, ModelOption[]> = {};
  for (const option of options) {
    const provider = option.value.split("/")[0]!;
    (byProvider[provider] ??= []).push(option);
  }
  return byProvider;
}

export const useModelSelectionOptions = ({
  options,
  model,
  mode = "chat",
  opts,
}: {
  options: string[];
  model: string;
  mode?: "chat" | "embedding";
  opts?: { featureKey?: string | undefined };
}) => {
  const { project } = usePromptProject();
  // `listAllForProjectForFrontend` returns providers actually stored for this
  // project - unlike the legacy `getAllForProject`, it does not merge env-fed defaults.
  const modelProviders = promptApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  // Memoized as one block: the derivation runs on data changes, not on every
  // render of the caller. Without this, each render handed back fresh
  // `selectOptions` / `groupedByProvider` arrays, so every downstream
  // `useMemo` keyed on them recomputed too - the langy composer's model pill
  // rebuilt its whole combobox collection per parent render because of it.
  const providers = modelProviders.data;
  const featureKey = opts?.featureKey;
  const { selectOptions, groupedByProvider } = useMemo(() => {
    const providersByKey = mergeProviderRowsByKey(providers ?? []);

    const customModelIdSet = new Set(
      listCustomModelIds({ modelProviders: providersByKey, mode, enabledOnly: false }),
    );

    // Gemini's Agent Platform door serves chat but not embeddings
    // (:batchEmbedContents 404s on aiplatform.googleapis.com). Registry
    // embedding models are hidden there; explicit custom models stay - the
    // customer's own claim about their endpoint.
    const withoutRegistryModels = providersWithoutRegistryModels(providers ?? [], mode);

    const allModels = filterRestrictedModels({
      models: getCustomModels(providersByKey, options, mode),
      featureKey,
    }).filter(
      (model) => customModelIdSet.has(model) || !withoutRegistryModels.has(model.split("/")[0]!),
    );

    const displayNames = buildCustomModelDisplayNames(providers ?? []);

    const selectOptions: ModelOption[] = allModels.map((modelValue) => {
      const provider = modelValue.split("/")[0]!;

      return {
        label: modelDisplayLabel({ fullModelId: modelValue, displayNames }),
        value: modelValue,
        icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
        isDisabled: false,
        mode: mode,
        isCustom: customModelIdSet.has(modelValue),
      };
    });

    // Group models by provider, with custom models at the top of each group
    const groupedByProvider: GroupedModelOptions = Object.entries(
      groupOptionsByProvider(selectOptions),
    ).map(([provider, models]) => ({
      provider,
      icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
      // Custom models first, then registry models
      models: [...models.filter((m) => m.isCustom), ...models.filter((m) => !m.isCustom)],
    }));

    return { selectOptions, groupedByProvider };
  }, [providers, options, mode, featureKey]);

  const modelOption = selectOptions.find((opt) => opt.value === model);

  // The application's copy carries a dev-only `?__no_models=1` escape hatch,
  // gated on `import.meta.env.PROD`. Neither travels: a browser module
  // reads no build-time environment, and the screen's own suites construct the
  // empty case directly rather than through a URL.
  const forceEmpty = false;

  return {
    modelOption,
    selectOptions,
    groupedByProvider,
    /** True while the providers query is in flight. Callers that
     *  render their own trigger should show a skeleton instead of the
     *  empty-state callout so the user doesn't see a "No models
     *  configured" flash before the data resolves. */
    isLoading: modelProviders.isLoading,
    /** True when the project has zero models of the requested mode
     *  available. Lets callers that render their own trigger (e.g.
     *  LLMConfigField) swap to the empty-state callout instead of
     *  echoing back the stale persisted value. */
    isEmpty: selectOptions.length === 0 || forceEmpty,
  };
};

/**
 * Builds the available-models list: custom models first, then registry models.
 * @param modelProviders - Provider keys to their configuration
 * @param options - Registry model IDs (e.g., "openai/gpt-4o")
 * @param mode - Whether to include chat or embedding custom models
 * @returns Combined list of model IDs, custom first then registry
 */
export const getCustomModels = (
  modelProviders: Record<string, MaybeStoredModelProvider>,
  options: string[],
  mode: "chat" | "embedding" = "chat",
): string[] => {
  const registryModelIds: string[] = [];

  // Custom models first, so they appear at the top
  const customModelIds = listCustomModelIds({ modelProviders, mode, enabledOnly: true });

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
