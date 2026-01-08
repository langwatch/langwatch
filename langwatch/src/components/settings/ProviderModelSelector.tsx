import {
  HStack,
  Input,
  Box,
  Field,
} from "@chakra-ui/react";
import React, { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { createListCollection } from "@chakra-ui/react";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { Select } from "../ui/select";
import { InputGroup } from "../ui/input-group";

/**
 * A simple model selector for a specific provider.
 * Shows only the models passed in options without fetching from API.
 * Used in the model provider settings form to select default models.
 */
export const ProviderModelSelector = React.memo(function ProviderModelSelector({
  model,
  options,
  onChange,
  providerKey,
  size = "full",
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  providerKey: string;
  size?: "sm" | "md" | "full";
}) {
  const [modelSearch, setModelSearch] = useState("");

  const providerIcon = modelProviderIcons[providerKey as keyof typeof modelProviderIcons];

  // Create model options with labels (model name without provider prefix)
  const selectOptions = useMemo(() => 
    options.map((modelValue) => ({
      label: modelValue.split("/").slice(1).join("/"),
      value: modelValue,
      icon: providerIcon,
    })),
    [options, providerIcon]
  );

  // Filter models by search
  const filteredModels = useMemo(() => 
    selectOptions.filter(
      (item) =>
        item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
        item.value.toLowerCase().includes(modelSearch.toLowerCase())
    ),
    [selectOptions, modelSearch]
  );

  const modelCollection = createListCollection({
    items: filteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);

  const selectValueText = (
    <HStack overflow="hidden" gap={2} align="center">
      {providerIcon && (
        <Box minWidth="16px">
          {providerIcon}
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
        {filteredModels.map((item) => (
          <Select.Item key={item.value} item={item}>
            <HStack gap={2}>
              {providerIcon && (
                <Box width="14px" minWidth="14px">
                  {providerIcon}
                </Box>
              )}
              <Box fontSize={14} fontFamily="mono" paddingY="2px">
                {item.label}
              </Box>
            </HStack>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
});
