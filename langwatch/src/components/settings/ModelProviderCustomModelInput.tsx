import {
  VStack,
  Text,
  Box,
  Combobox,
  TagsInput,
  useCombobox,
  useFilter,
  useListCollection,
  useTagsInput,
  Field,
} from "@chakra-ui/react";
import React, { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type {
  UseModelProviderFormState,
  UseModelProviderFormActions,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";

/**
 * Renders a multi-input field for specifying custom model names.
 * Only visible for the "custom" provider type (e.g., LiteLLM proxy, self-hosted vLLM).
 * Users can add comma-separated model names or create them individually.
 * @param state - Form state containing custom model names
 * @param actions - Form actions for managing custom models
 * @param provider - The model provider configuration
 */
export const CustomModelInputSection = ({
  state,
  actions,
  provider,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
}) => {
  const inputId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);

  const customModelValues = useMemo(
    () => state.customModels.map((m) => m.value),
    [state.customModels]
  );

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: [] as string[],
    filter: contains,
  });

  const handleTagsValueChange = useCallback(
    (details: { value: string[] }) => {
      actions.setCustomModels(
        details.value.map((value) => ({ label: value, value }))
      );
    },
    [actions]
  );

  const tags = useTagsInput({
    ids: { input: inputId },
    value: customModelValues,
    onValueChange: handleTagsValueChange,
  });

  useEffect(() => {
    const differs =
      tags.value.length !== customModelValues.length ||
      tags.value.some((value, index) => value !== customModelValues[index]);
    if (differs) {
      tags.setValue(customModelValues);
    }
  }, [customModelValues, tags]);

  const handleComboboxInputChange = useCallback(
    (event: { inputValue: string }) => {
      filter(event.inputValue);
    },
    [filter]
  );

  const handleComboboxValueChange = useCallback(
    (event: { value?: string[] }) => {
      const nextValue = event.value?.[0];
      if (!nextValue) return;
      if (!customModelValues.includes(nextValue)) {
        tags.addValue(nextValue);
      }
    },
    [customModelValues, tags]
  );

  const combobox = useCombobox({
    ids: { input: inputId },
    collection,
    allowCustomValue: true,
    value: [],
    selectionBehavior: "clear",
    positioning: {
      getAnchorRect: () => controlRef.current?.getBoundingClientRect() ?? null,
    },
    onInputValueChange: handleComboboxInputChange,
    onValueChange: handleComboboxValueChange,
  });

  if (provider.provider !== "custom") {
    return null;
  }

  return (
    <VStack width="full" align="start" gap={2} paddingTop={4}>
      <SmallLabel>Models</SmallLabel>
      <Text fontSize="xs" color="gray.500">
        Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that support the /chat/completions endpoint.
      </Text>
      <Box width="full">
        <Field.Root>
          <Combobox.RootProvider value={combobox}>
            <TagsInput.RootProvider value={tags} size="sm">
              <TagsInput.Control ref={controlRef}>
                {tags.value.map((tag, index) => (
                  <TagsInput.Item key={index} index={index} value={tag}>
                    <TagsInput.ItemPreview
                      borderRadius="md"
                    >
                      <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                      <TagsInput.ItemDeleteTrigger />
                    </TagsInput.ItemPreview>
                    <TagsInput.ItemInput />
                  </TagsInput.Item>
                ))}
                <Combobox.Input unstyled asChild>
                  <TagsInput.Input placeholder="Add custom model" />
                </Combobox.Input>
              </TagsInput.Control>
              <TagsInput.HiddenInput />
              <Combobox.Positioner>
                <Combobox.Content borderRadius="md">
                  <Combobox.Empty>
                    <Text fontSize="sm" color="gray.500">
                      Type to add a model
                    </Text>
                  </Combobox.Empty>
                </Combobox.Content>
              </Combobox.Positioner>
            </TagsInput.RootProvider>
          </Combobox.RootProvider>
        </Field.Root>
      </Box>
    </VStack>
  );
};
