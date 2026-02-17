import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
} from "@chakra-ui/react";
import { Search, Settings } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "../server/modelProviders/iconsMap";
import type { MaybeStoredModelProvider } from "../server/modelProviders/registry";
import { allLitellmModels } from "../server/modelProviders/registry";
import { api } from "../utils/api";
import { titleCase } from "../utils/stringCasing";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "./llmPromptConfigs/constants";
import { InputGroup } from "./ui/input-group";
import { Link } from "./ui/link";
import { Select } from "./ui/select";
import { LuSettings2 } from "react-icons/lu";

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
  isCustom?: boolean;
};

export const modelSelectorOptions: ModelOption[] = Object.entries(
  allLitellmModels,
).map(([key, value]) => ({
  label: key,
  value: key,
  icon: modelProviderIcons[
    key.split("/")[0] as keyof typeof modelProviderIcons
  ],
  isDisabled: false,
  mode: value.mode as "chat" | "embedding",
}));

export const allModelOptions = modelSelectorOptions.map(
  (option) => option.value,
);

export type ModelOptionGroup = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
};

export type GroupedModelOptions = ModelOptionGroup[];

export const useModelSelectionOptions = (
  options: string[],
  model: string,
  mode: "chat" | "embedding" = "chat",
) => {
  const { project } = useOrganizationTeamProject();
  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id, refetchOnMount: false },
  );

  const allModels = getCustomModels(
    modelProviders.data ?? {},
    options,
    mode,
  );

  // Build a set of custom model IDs for quick lookup
  const customModelIdSet = new Set<string>();
  for (const [providerKey, config] of Object.entries(
    modelProviders.data ?? {},
  )) {
    const customList =
      mode === "chat" ? config.customModels : config.customEmbeddingsModels;
    if (customList) {
      for (const model of customList) {
        customModelIdSet.add(`${providerKey}/${model.modelId}`);
      }
    }
  }

  const selectOptions: ModelOption[] = allModels.map((modelValue) => {
    const provider = modelValue.split("/")[0]!;
    const modelName = modelValue.split("/").slice(1).join("/");

    return {
      label: modelName,
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
    models: [
      ...models.filter((m) => m.isCustom),
      ...models.filter((m) => !m.isCustom),
    ],
  }));

  const modelOption = selectOptions.find((opt) => opt.value === model);

  return { modelOption, selectOptions, groupedByProvider };
};

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
  size = "md",
  mode,
  showConfigureAction = false,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding";
  /** When true, shows a "Configure available models" link at the bottom of the dropdown */
  showConfigureAction?: boolean;
}) {
  const { selectOptions, groupedByProvider } = useModelSelectionOptions(
    options,
    model,
    mode,
  );

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

  const selectValueText = (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedItem?.icon && (
        <Box minWidth={size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE}>
          {selectedItem.icon}
        </Box>
      )}
      <Box
        fontSize={size === "sm" ? 12 : 14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isUnknown ? "gray.500" : undefined}
      >
        {selectedItem?.label ?? model}
      </Box>
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(
    model,
  );

  useEffect(() => {
    const highlightedItem = modelCollection.items.find(
      (item) => item.value === highlightedValue,
    );
    if (!highlightedItem) {
      setHighlightedValue(modelCollection.items[0]?.value ?? null);
    }
  }, [highlightedValue, modelCollection.items]);

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
        <Select.ValueText placeholder={selectValueText}>
          {() => selectValueText}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content zIndex="1600">
        <Field.Root asChild>
          <Box position="sticky" top={0} zIndex="1">
            <InputGroup
              startElement={<Search size={16} />}
              startOffset="-4px"
              background="white"
              width="calc(100%)"
              paddingY={1}
              borderBottom="1px solid"
              borderColor="border"
            >
              <Input
                variant={"plain" as any}
                size="sm"
                placeholder="Search models"
                type="search"
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
                      <Box
                        borderBottom="1px solid"
                        borderColor="blackAlpha.100"
                        marginX={2}
                        marginY={1}
                      />
                    )}
                    <Select.Item item={item}>
                      <HStack gap={2}>
                        {item.icon && (
                          <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
                            {item.icon}
                          </Box>
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
            bg="white"
            borderTop="1px solid"
            borderColor="border"
            zIndex="1"
          >
            <Button width="full" fontWeight="500" color="fg.muted" paddingY={5} justifyContent="flex-start" variant="ghost" colorPalette="gray" size="sm" borderRadius="none" asChild>
              <Link
                href="/settings/model-providers"
                isExternal
                _hover={{ textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                <LuSettings2 />
                <Text fontSize={size === "sm" ? 12 : 14}>
                  Configure available models
                </Text>
              </Link>
            </Button>
          </Box>
        )}
      </Select.Content>
    </Select.Root>
  );
});

/**
 * Builds the list of available models by combining registry models with custom models.
 *
 * Registry models from `options` are always included for enabled providers,
 * filtered by mode (chat or embedding). Custom models are returned first
 * so they appear at the top of the selector.
 *
 * @param modelProviders - Map of provider keys to their configuration
 * @param options - Registry model IDs (e.g., "openai/gpt-4o")
 * @param mode - Whether to include chat or embedding custom models
 * @returns Combined list of model IDs for enabled providers (custom first, then registry)
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
    const customList =
      mode === "chat" ? config.customModels : config.customEmbeddingsModels;
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
