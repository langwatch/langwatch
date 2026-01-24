import {
  Box,
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

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | undefined;
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

export type GroupedModelOptions = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
}[];

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

  const customModels = getCustomModels(
    modelProviders.data ?? {},
    options,
    mode,
  );

  // Filter to only include models from enabled providers
  const enabledModels = customModels.filter((modelValue) => {
    const provider = modelValue.split("/")[0]!;
    return modelProviders.data?.[provider]?.enabled;
  });

  const selectOptions: ModelOption[] = enabledModels.map((modelValue) => {
    const provider = modelValue.split("/")[0]!;
    const modelName = modelValue.split("/").slice(1).join("/");

    return {
      label: modelName,
      value: modelValue,
      icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
      isDisabled: false,
      mode: mode,
    };
  });

  // Group models by provider
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
    models,
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
        background="white"
        padding={0}
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
              width="calc(100% - 9px)"
            >
              <Input
                size="sm"
                placeholder="Search models"
                type="search"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </InputGroup>
          </Box>
        </Field.Root>
        {filteredGroups.map((group) => (
          <Select.ItemGroup
            key={group.provider}
            label={
              <HStack gap={2}>
                <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
                  {group.icon}
                </Box>
                <Text fontWeight="medium">{titleCase(group.provider)}</Text>
              </HStack>
            }
          >
            {group.models.map((item) => (
              <Select.Item key={item.value} item={item}>
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
            ))}
          </Select.ItemGroup>
        ))}
        {showConfigureAction && (
          <Box
            padding={2}
            position="sticky"
            bottom={-1}
            bg="white"
            borderTop="1px solid"
            borderColor="border"
            zIndex="1"
            marginTop={1}
          >
            <Link
              href="/settings/model-providers"
              isExternal
              _hover={{ textDecoration: "none" }}
              onClick={(e) => e.stopPropagation()}
            >
              <HStack
                width="full"
                padding={2}
                borderRadius="md"
                border="1px solid"
                borderColor="border"
                cursor="pointer"
                color="fg.muted"
                _hover={{ bg: "gray.50", color: "gray.800" }}
                transition="all 0.15s"
                gap={2}
              >
                <Settings size={16} />
                <Text fontSize={size === "sm" ? 12 : 14}>
                  Configure available models
                </Text>
              </HStack>
            </Link>
          </Box>
        )}
      </Select.Content>
    </Select.Root>
  );
});

const getCustomModels = (
  modelProviders: Record<string, MaybeStoredModelProvider>,
  options: string[],
  mode: "chat" | "embedding" = "chat",
) => {
  const models: string[] = [];

  const customProviders: string[] = [];

  for (const provider of Object.keys(modelProviders)) {
    const providerConfig = modelProviders[provider];
    if (!providerConfig) continue;

    if (providerConfig.enabled && providerConfig.models && mode === "chat") {
      providerConfig.models.forEach((model: string) => {
        models.push(`${provider}/${model}`);
        customProviders.push(provider);
      });
    }

    if (
      providerConfig.enabled &&
      providerConfig.embeddingsModels &&
      mode === "embedding"
    ) {
      providerConfig.embeddingsModels.forEach((model: string) => {
        models.push(`${provider}/${model}`);
        customProviders.push(provider);
      });
    }
  }

  if (customProviders.length > 0) {
    options.forEach((option) => {
      const optionProvider = option.split("/")[0]!;

      if (!customProviders.includes(optionProvider)) {
        models.push(option);
      }
    });

    return models;
  }

  return options;
};
