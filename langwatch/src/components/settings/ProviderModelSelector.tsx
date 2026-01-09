import {
  HStack,
  Input,
  Box,
  Field,
  Text,
} from "@chakra-ui/react";
import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { createListCollection } from "@chakra-ui/react";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { Select } from "../ui/select";
import { InputGroup } from "../ui/input-group";
import { titleCase } from "../../utils/stringCasing";

type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
};

type GroupedModelOptions = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
}[];

/**
 * A model selector that supports models from multiple providers.
 * Derives the provider icon from each model's prefix (e.g., "openai/gpt-4" -> openai icon).
 * Groups models by provider for better organization.
 * Used in the model provider settings form to select default models.
 */
export const ProviderModelSelector = React.memo(function ProviderModelSelector({
  model,
  options,
  onChange,
  size = "full",
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
}) {
  const [modelSearch, setModelSearch] = useState("");

  // Create model options with labels and derive icon from each model's provider
  const selectOptions = useMemo(() => 
    options.map((modelValue) => {
      const modelProvider = modelValue.split("/")[0] ?? "";
      const icon = modelProviderIcons[modelProvider as keyof typeof modelProviderIcons];
      return {
        label: modelValue.split("/").slice(1).join("/"),
        value: modelValue,
        icon,
      };
    }),
    [options]
  );

  // Group models by provider
  const groupedByProvider: GroupedModelOptions = useMemo(() => 
    Object.entries(
      selectOptions.reduce(
        (acc, option) => {
          const provider = option.value.split("/")[0]!;
          if (!acc[provider]) {
            acc[provider] = [];
          }
          acc[provider].push(option);
          return acc;
        },
        {} as Record<string, ModelOption[]>
      )
    ).map(([provider, models]) => ({
      provider,
      icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
      models,
    })),
    [selectOptions]
  );

  // Filter models by search and group by provider
  const filteredGroups = useMemo(() => 
    groupedByProvider
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (item) =>
            item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
            item.value.toLowerCase().includes(modelSearch.toLowerCase())
        ),
      }))
      .filter((group) => group.models.length > 0),
    [groupedByProvider, modelSearch]
  );

  // Flatten for collection
  const allFilteredModels = filteredGroups.flatMap((group) => group.models);

  const modelCollection = createListCollection({
    items: allFilteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);
  const selectedIcon = selectedItem?.icon ?? modelProviderIcons[model.split("/")[0] as keyof typeof modelProviderIcons];

  const selectValueText = (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedIcon && (
        <Box minWidth="16px">
          {selectedIcon}
        </Box>
      )}
      <Box
        fontSize={14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
      >
        {selectedItem?.label ?? model.split("/").slice(1).join("/")}
      </Box>
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(model);

  useEffect(() => {
    const highlightedItem = modelCollection.items.find(
      (item) => item.value === highlightedValue
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
                <Box width="14px" minWidth="14px">
                  {group.icon}
                </Box>
                <Text fontWeight="medium">{titleCase(group.provider)}</Text>
              </HStack>
            }
          >
            {group.models.map((item) => (
              <Select.Item key={item.value} item={item}>
                <Box fontSize={14} fontFamily="mono" paddingY="2px">
                  {item.label}
                </Box>
              </Select.Item>
            ))}
          </Select.ItemGroup>
        ))}
      </Select.Content>
    </Select.Root>
  );
});
