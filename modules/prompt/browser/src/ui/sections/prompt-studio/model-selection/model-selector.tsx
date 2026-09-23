import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Skeleton,
  Text,
} from "@chakra-ui/react";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  isCodexModel,
  isModelAllowedForFeature,
  buildCustomModelDisplayNames,
  modelDisplayLabel,
  allLitellmModels,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import { AlertTriangle, Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { LuSettings2 } from "react-icons/lu";

import { promptApi } from "../../../../behavior/prompt-api.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "../../../../model/model-selection-constants.ts";
import { titleCase } from "../../../../model/string-casing.ts";
import { Link } from "../../../../ui/elements/prompt-link.tsx";
import { modelProviderIcons, ProviderIconGlyph } from "./model-provider-icons.tsx";
import { NoModelsConfiguredCallout } from "./no-models-configured-callout.tsx";

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
  isCustom?: boolean;
};

const SKELETON_WIDTHS: Record<"sm" | "md" | "full", string> = {
  full: "full",
  sm: "180px",
  md: "240px",
};

export const modelSelectorOptions: ModelOption[] = Object.entries(allLitellmModels).map(
  ([key, value]) => ({
    label: key,
    value: key,
    icon: modelProviderIcons[key.split("/")[0] as keyof typeof modelProviderIcons],
    isDisabled: false,
    mode: value.mode as "chat" | "embedding",
  }),
);

export const allModelOptions = modelSelectorOptions.map((option) => option.value);

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

    // Build a set of custom model IDs for quick lookup
    const customModelIdSet = new Set<string>();
    for (const [providerKey, config] of Object.entries(providersByKey)) {
      const customList = mode === "chat" ? config.customModels : config.customEmbeddingsModels;
      if (customList) {
        for (const model of customList) {
          customModelIdSet.add(`${providerKey}/${model.modelId}`);
        }
      }
    }

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
      selectOptions.reduce(
        (acc, option) => {
          const provider = option.value.split("/")[0]!;
          if (!acc[provider]) {
            acc[provider] = [];
          }
          acc[provider].push(option);
          return acc;
        },
        {} as Record<string, ModelOption[]>,
      ),
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
  // gated on `import.meta.env.PROD`. Neither travels: a feature-web package
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

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
  size = "md",
  mode,
  showConfigureAction = false,
  forFeatureLabel,
  featureKey,
  open,
  onOpenChange,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding";
  /** The feature this picker serves, for the restricted-provider gate
   *  (`filterRestrictedModels`): a picker that names a codex-licensed
   *  feature (e.g. Langy's `langy.chat`) may offer codex models; one
   *  that names none never sees them. */
  featureKey?: string;
  /** When true, shows a "Configure available models" link at the bottom of the dropdown */
  showConfigureAction?: boolean;
  /** Surface-specific label used in the empty-state callout when no
   *  models are available - e.g. "for AI search", "for evaluators".
   *  Optional; the callout falls back to a generic message. */
  forFeatureLabel?: string;
  /** Controlled open state. Pass with onOpenChange to drive the dropdown
   *  from outside - e.g. force-close it when the parent collapses. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { selectOptions, groupedByProvider, isEmpty, isLoading } = useModelSelectionOptions({
    options,
    model,
    mode,
    opts: { featureKey },
  });

  // ALL hooks must run unconditionally - keep the empty-state early
  // return *after* every hook below so we don't violate React's rules
  // of hooks when isEmpty flips between renders.
  const [modelSearch, setModelSearch] = useState("");

  // Filter models by search and group by provider
  const filteredGroups = groupedByProvider
    .map((group) => ({
      ...group,
      models: group.models.filter(
        (item) =>
          item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
          item.value.toLowerCase().includes(modelSearch.toLowerCase()),
      ),
    }))
    .filter((group) => group.models.length > 0);

  // Flatten for collection (needed by Chakra Select)
  const allFilteredModels = filteredGroups.flatMap((group) => group.models);

  const modelCollection = createListCollection({
    items: allFilteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);

  // Model might not be in the list if it's a custom model or unknown
  const isUnknown = !selectedItem;

  // Provider gone (deleted or never configured at any reachable
  // scope) - the value is still persisted on the form but the user
  // needs to update it before the evaluation can run. Same chip
  // treatment ModelChip renders in the Default Models table.
  const providerKey = model.split("/")[0] ?? "";
  const isProviderMissing =
    !!model && !!providerKey && !groupedByProvider.some((group) => group.provider === providerKey);

  const unknownColor = isUnknown ? "gray.500" : undefined;
  const selectedColor = isProviderMissing ? "red.600" : unknownColor;

  const selectValueText = (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedItem?.icon && (
        <ProviderIconGlyph
          provider={providerKey as keyof typeof modelProviderIcons}
          size={size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE}
        />
      )}
      <Box
        fontSize={size === "sm" ? 12 : 14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={selectedColor}
        textDecoration={isProviderMissing ? "line-through" : undefined}
      >
        {selectedItem?.label ?? model}
      </Box>
      {isProviderMissing && (
        <Tooltip
          content={`${providerKey} provider isn't enabled here. Re-add the provider or pick a different model to use it.`}
          positioning={{ placement: "top" }}
          showArrow
        >
          <HStack gap={1} color="red.600" flexShrink={0}>
            <AlertTriangle size={size === "sm" ? 12 : 14} aria-hidden />
            <Text
              fontSize={size === "sm" ? "2xs" : "xs"}
              fontWeight="medium"
              textTransform="uppercase"
              letterSpacing="wide"
            >
              Update needed
            </Text>
          </HStack>
        </Tooltip>
      )}
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(model);

  useEffect(() => {
    const highlightedItem = allFilteredModels.find((item) => item.value === highlightedValue);
    if (!highlightedItem) {
      const firstValue = allFilteredModels[0]?.value ?? null;
      if (firstValue !== highlightedValue) {
        setHighlightedValue(firstValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelSearch]);

  // Skeleton while the providers query is in flight so the empty
  // state doesn't flash before the data resolves.
  if (isLoading) {
    return (
      <Skeleton
        width={SKELETON_WIDTHS[size]}
        height={size === "sm" ? "28px" : "40px"}
        borderRadius="md"
      />
    );
  }

  // Honest empty state: when the project has zero enabled providers
  // (or zero models of the requested mode), render a guided callout
  // instead of the dropdown. The prior behaviour was to render the
  // System fallback string ("openai/gpt-5.2") in gray, which looked
  // like a real selection but errored at runtime.
  if (isEmpty) {
    return <NoModelsConfiguredCallout size={size} forFeatureLabel={forFeatureLabel} />;
  }

  return (
    <Select.Root
      collection={modelCollection}
      value={[model]}
      onChange={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onValueChange={(change) => {
        const selectedValue = change.value[0];
        if (selectedValue) {
          onChange(selectedValue);
        }
      }}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange: (e) => onOpenChange(e.open) } : {})}
      loopFocus={true}
      highlightedValue={highlightedValue}
      onHighlightChange={(details) => {
        setHighlightedValue(details.highlightedValue);
      }}
      size={size === "full" ? undefined : size}
    >
      <Select.Trigger
        className="fix-hidden-inputs"
        width={size === "full" ? "100%" : "auto"}
        background="bg"
        borderRadius="lg"
        padding={0}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Select.ValueText placeholder={selectValueText}>{() => selectValueText}</Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        <Field.Root asChild>
          <Box position="sticky" top={0} zIndex="1">
            <InputGroup
              startElement={<Search size={16} />}
              startOffset="-4px"
              background="bg.panel"
              width="calc(100%)"
              paddingY={1}
              borderBottom="1px solid"
              borderColor="border"
            >
              <Input
                variant="flushed"
                size="sm"
                placeholder="Search models"
                type="search"
                background="transparent"
                color="fg"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </InputGroup>
          </Box>
        </Field.Root>
        {filteredGroups.map((group) => {
          const hasCustom = group.models.some((m) => m.isCustom);
          const hasRegistry = group.models.some((m) => !m.isCustom);

          return (
            <Select.ItemGroup
              key={group.provider}
              label={
                <HStack gap={2} paddingX={2}>
                  <Text fontWeight="medium">{titleCase(group.provider)}</Text>
                </HStack>
              }
            >
              {group.models.map((item, itemIndex) => {
                // Add a subtle divider between custom and registry models
                const prevItem = group.models[itemIndex - 1];
                const showDivider =
                  hasCustom && hasRegistry && !item.isCustom && prevItem?.isCustom;

                return (
                  <React.Fragment key={item.value}>
                    {showDivider && (
                      <Box borderBottom="1px solid" borderColor="border" marginX={2} marginY={1} />
                    )}
                    <Select.Item item={item}>
                      <HStack gap={2}>
                        {item.icon && (
                          <ProviderIconGlyph
                            provider={item.value.split("/")[0] as keyof typeof modelProviderIcons}
                            size={MODEL_ICON_SIZE}
                          />
                        )}
                        <Box
                          fontSize={size === "sm" ? 12 : 14}
                          fontFamily="mono"
                          paddingY={size === "sm" ? 0 : "2px"}
                        >
                          {item.label}
                        </Box>
                      </HStack>
                    </Select.Item>
                  </React.Fragment>
                );
              })}
            </Select.ItemGroup>
          );
        })}
        {showConfigureAction && (
          <Box
            position="sticky"
            bottom={0}
            bg="bg.panel"
            borderTop="1px solid"
            borderColor="border"
            zIndex="1"
          >
            <Button
              width="full"
              fontWeight="500"
              color="fg.muted"
              paddingY={5}
              justifyContent="flex-start"
              variant="ghost"
              colorPalette="gray"
              size="sm"
              borderRadius="none"
              asChild
            >
              <Link
                href="/settings/model-providers"
                isExternal
                _hover={{ textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                <LuSettings2 />
                <Text fontSize={size === "sm" ? 12 : 14}>Configure available models</Text>
              </Link>
            </Button>
          </Box>
        )}
      </Select.Content>
    </Select.Root>
  );
});

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
  const customModelIds: string[] = [];
  const registryModelIds: string[] = [];

  // Add custom models first so they appear at the top
  for (const [providerKey, config] of Object.entries(modelProviders)) {
    if (!config.enabled) continue;
    const customList = mode === "chat" ? config.customModels : config.customEmbeddingsModels;
    if (customList) {
      for (const model of customList) {
        customModelIds.push(`${providerKey}/${model.modelId}`);
      }
    }
  }

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
