import {
  Box,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
} from "@chakra-ui/react";
import React, { useEffect, useState } from "react";
import { Search } from "react-feather";
import models from "../../models.json";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "../server/modelProviders/iconsMap";
import { api } from "../utils/api";
import { InputGroup } from "./ui/input-group";
import { Select } from "./ui/select";

export type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  isDisabled: boolean;
  mode?: "chat" | "embedding" | "evaluator" | undefined;
};

export const modelSelectorOptions: ModelOption[] = Object.entries(models).map(
  ([key, value]) => ({
    label: key,
    value: key,
    icon: modelProviderIcons[
      key.split("/")[0] as keyof typeof modelProviderIcons
    ],
    isDisabled: false,
    mode: value.mode as "chat" | "embedding" | "evaluator",
  })
);

export const allModelOptions = modelSelectorOptions.map(
  (option) => option.value
);

export const useModelSelectionOptions = (
  options: string[],
  model: string,
  mode: "chat" | "embedding" | "evaluator" = "chat"
) => {
  const { project } = useOrganizationTeamProject();
  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id }
  );

  const customModels = getCustomModels(
    modelProviders.data ?? {},
    options,
    mode
  );

  const selectOptions: Record<string, ModelOption> = Object.fromEntries(
    customModels.map((model): [string, ModelOption] => {
      const provider = model.split("/")[0]!;
      const modelName = model.split("/").slice(1).join("/");

      return [
        model,
        {
          label: modelName,
          value: model,
          icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
          isDisabled: !modelProviders.data?.[provider]?.enabled,
          mode: mode,
        },
      ];
    })
  );

  const modelOption = selectOptions[model];

  return { modelOption, selectOptions: Object.values(selectOptions) };
};

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
  size = "md",
  mode,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding" | "evaluator";
}) {
  const { selectOptions } = useModelSelectionOptions(options, model, mode);

  const [modelSearch, setModelSearch] = useState("");

  const options_ = selectOptions.map((option) => ({
    label: option.label,
    value: option.value,
    icon: option.icon,
    isDisabled: option.isDisabled,
    mode: option.mode,
  }));

  const modelCollection = createListCollection({
    items: options_.filter(
      (item) =>
        item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
        item.value.toLowerCase().includes(modelSearch.toLowerCase())
    ),
  });

  const selectedItem = options_.find((option) => option.value === model);

  const isDisabled = selectOptions.find(
    (option) => option.value === selectedItem?.value
  )?.isDisabled;

  const isDeprecated = !selectedItem;

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
        {selectedItem?.label ?? model}
      </Box>
      {(isDisabled ?? isDeprecated) && (
        <Text
          fontSize={size === "sm" ? 12 : 14}
          fontFamily="mono"
          color="gray.400"
        >
          {isDeprecated ? "(deprecated)" : "(disabled)"}
        </Text>
      )}
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(
    model
  );

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
      size={size === "full" ? "lg" : size}
    >
      <Select.Trigger
        className="fix-hidden-inputs"
        width={size === "full" ? "100%" : "auto"}
        background="white"
        borderRadius="5px"
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
        {modelCollection.items.map((item) => (
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
});

const getCustomModels = (
  modelProviders: Record<string, any>,
  options: string[],
  mode: "chat" | "embedding" | "evaluator" = "chat"
) => {
  const models: string[] = [];

  const customProviders: string[] = [];

  for (const provider in modelProviders) {
    if (
      modelProviders[provider].enabled &&
      modelProviders[provider].models &&
      mode === "chat"
    ) {
      modelProviders[provider].models.forEach((model: string) => {
        models.push(`${provider}/${model}`);
        customProviders.push(provider);
      });
    }

    if (
      modelProviders[provider].enabled &&
      modelProviders[provider].embeddingsModels &&
      mode === "embedding"
    ) {
      modelProviders[provider].embeddingsModels?.forEach((model: string) => {
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
