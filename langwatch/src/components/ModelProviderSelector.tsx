import {
  Box,
  createListCollection,
  HStack,
  Text,
} from "@chakra-ui/react";
import React, { useEffect, useState } from "react";

import { modelProviderIcons } from "../server/modelProviders/iconsMap";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../server/modelProviders/registry";
import { Select } from "./ui/select";

export type ProviderOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
};

export const useProviderSelectionOptions = (
  providers: Record<string, MaybeStoredModelProvider> | undefined,
  selectedProvider: string | undefined,
) => {
  // Filter to only show providers that are NOT enabled (disabled providers)
  const disabledProviders = providers
    ? Object.entries(providers).filter(([_, provider]) => !provider.enabled)
    : [];

  const selectOptions: Record<string, ProviderOption> = {};

  // Always include "custom" provider option
  const customProviderDefinition =
    modelProvidersRegistry["custom" as keyof typeof modelProvidersRegistry];
  selectOptions["custom"] = {
    label: customProviderDefinition?.name || "custom",
    value: "custom",
    icon: modelProviderIcons["custom" as keyof typeof modelProviderIcons] || null,
    isDisabled: false,
  };

  // Add disabled providers (excluding custom if it's already in the list)
  disabledProviders.forEach(([providerKey, _]) => {
    if (providerKey === "custom") return; // Already added above
    
    const providerDefinition =
      modelProvidersRegistry[providerKey as keyof typeof modelProvidersRegistry];
    const providerName = providerDefinition?.name || providerKey;

    selectOptions[providerKey] = {
      label: providerName,
      value: providerKey,
      icon:
        modelProviderIcons[
          providerKey as keyof typeof modelProviderIcons
        ] || null,
      isDisabled: false,
    };
  });

  const providerOption = selectedProvider
    ? selectOptions[selectedProvider]
    : undefined;

  return {
    providerOption,
    selectOptions: Object.values(selectOptions),
  };
};

export const ModelProviderSelector = React.memo(
  function ModelProviderSelector({
    provider,
    providers,
    onChange,
    size = "md",
  }: {
    provider: string | undefined;
    providers: Record<string, MaybeStoredModelProvider> | undefined;
    onChange: (provider: string) => void;
    size?: "sm" | "md" | "full";
  }) {
    const { selectOptions } = useProviderSelectionOptions(
      providers,
      provider,
    );

    const options_ = selectOptions.map((option) => ({
      label: option.label,
      value: option.value,
      icon: option.icon,
      isDisabled: option.isDisabled,
    }));

    const providerCollection = createListCollection({
      items: options_,
    });

    const selectedItem = options_.find((option) => option.value === provider);

    const isDisabled = selectOptions.find(
      (option) => option.value === selectedItem?.value,
    )?.isDisabled;

    const selectValueText = (
      <HStack
        overflow="hidden"
        gap={2}
        align="center"
        opacity={isDisabled ? 0.5 : 1}
      >
        {selectedItem?.icon && (
          <Box minWidth={size === "sm" ? "14px" : "16px"}>
            {selectedItem.icon}
          </Box>
        )}
        <Box
          fontSize={size === "sm" ? 12 : 14}
          fontFamily="mono"
          lineClamp={1}
          wordBreak="break-all"
        >
          {selectedItem?.label ?? provider}
        </Box>
        {isDisabled && (
          <Text
            fontSize={size === "sm" ? 12 : 14}
            fontFamily="mono"
            color="gray.400"
          >
            (disabled)
          </Text>
        )}
      </HStack>
    );

    const [highlightedValue, setHighlightedValue] = useState<string | null>(
      provider ?? null,
    );

    useEffect(() => {
      const highlightedItem = providerCollection.items.find(
        (item) => item.value === highlightedValue,
      );
      if (!highlightedItem && providerCollection.items.length > 0) {
        setHighlightedValue(providerCollection.items[0]?.value ?? null);
      }
    }, [highlightedValue, providerCollection.items]);

    return (
      <Select.Root
        collection={providerCollection}
        value={provider ? [provider] : []}
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
          <Select.ValueText
            // @ts-ignore
            placeholder={selectValueText}
          >
            {() => selectValueText}
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content zIndex="1600">
          {providerCollection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              <HStack
                gap={3}
                align="center"
                paddingY={size === "sm" ? 0 : "2px"}
                alignItems="start"
              >
                <Box width="14px" minWidth="14px" paddingTop="3px">
                  {item.icon}
                </Box>
                <Box fontSize={size === "sm" ? 12 : 14} fontFamily="mono">
                  {item.label}
                  {item.isDisabled && (
                    <>
                      {" "}
                      <Text
                        display="inline-block"
                        fontSize={size === "sm" ? 12 : 14}
                        fontFamily="mono"
                        color="gray.400"
                      >
                        (disabled)
                      </Text>
                    </>
                  )}
                </Box>
              </HStack>
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    );
  },
);
