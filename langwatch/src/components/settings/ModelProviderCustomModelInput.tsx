import {
  VStack,
  Box,
  Combobox,
  TagsInput,
  useCombobox,
  useFilter,
  useListCollection,
  useTagsInput,
  Field,
} from "@chakra-ui/react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type {
  UseModelProviderFormState,
  UseModelProviderFormActions,
} from "../../hooks/useModelProviderForm";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
} from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";

type ModelTagsInputProps = {
  label: string;
  placeholder: string;
  values: string[];
  options: { value: string; label: string }[];
  onValuesChange: (values: string[]) => void;
};

/**
 * A reusable TagsInput component with Combobox for model selection.
 */
const ModelTagsInput = ({
  label,
  placeholder,
  values,
  options,
  onValuesChange,
}: ModelTagsInputProps) => {
  const inputId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);

  const optionValues = useMemo(() => options.map((o) => o.value), [options]);

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: optionValues,
    filter: contains,
  });

  const handleTagsValueChange = useCallback(
    (details: { value: string[] }) => {
      onValuesChange(details.value);
    },
    [onValuesChange]
  );

  const tags = useTagsInput({
    ids: { input: inputId },
    value: values,
    onValueChange: handleTagsValueChange,
  });

  useEffect(() => {
    const differs =
      tags.value.length !== values.length ||
      tags.value.some((value, index) => value !== values[index]);
    if (differs) {
      tags.setValue(values);
    }
  }, [values, tags]);

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
      if (!values.includes(nextValue)) {
        tags.addValue(nextValue);
      }
    },
    [values, tags]
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

  return (
    <Box width="full">
      <SmallLabel>{label}</SmallLabel>
      <Field.Root>
        <Combobox.RootProvider value={combobox}>
          <TagsInput.RootProvider value={tags} size="sm">
            <TagsInput.Control ref={controlRef} maxHeight="120px" overflowY="auto">
              {tags.value.map((tag, index) => (
                <TagsInput.Item key={index} index={index} value={tag}>
                  <TagsInput.ItemPreview borderRadius="md">
                    <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                    <TagsInput.ItemDeleteTrigger />
                  </TagsInput.ItemPreview>
                  <TagsInput.ItemInput />
                </TagsInput.Item>
              ))}
              <Combobox.Input unstyled asChild>
                <TagsInput.Input placeholder={placeholder} />
              </Combobox.Input>
            </TagsInput.Control>
            <TagsInput.HiddenInput />
            <Combobox.Positioner>
              <Combobox.Content borderRadius="md" maxHeight="200px" overflowY="auto">
                {collection.items.length > 0 ? (
                  collection.items.map((item) => (
                    <Combobox.Item key={item} item={item}>
                      <Combobox.ItemText>{item}</Combobox.ItemText>
                    </Combobox.Item>
                  ))
                ) : (
                  <Combobox.Empty>Type to add a model</Combobox.Empty>
                )}
              </Combobox.Content>
            </Combobox.Positioner>
          </TagsInput.RootProvider>
        </Combobox.RootProvider>
      </Field.Root>
    </Box>
  );
};

/**
 * Renders model and embeddings model selection fields for all providers.
 * Uses TagsInput with Combobox to allow selecting from known models or adding custom model names.
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
  const modelOptions = useMemo(
    () => getProviderModelOptions(provider.provider, "chat"),
    [provider.provider]
  );

  const embeddingsOptions = useMemo(
    () => getProviderModelOptions(provider.provider, "embedding"),
    [provider.provider]
  );

  const modelValues = useMemo(
    () => state.customModels.map((m) => m.value),
    [state.customModels]
  );

  const embeddingsValues = useMemo(
    () => state.customEmbeddingsModels.map((m) => m.value),
    [state.customEmbeddingsModels]
  );

  const handleModelsChange = useCallback(
    (values: string[]) => {
      actions.setCustomModels(values.map((v) => ({ label: v, value: v })));
    },
    [actions]
  );

  const handleEmbeddingsChange = useCallback(
    (values: string[]) => {
      actions.setCustomEmbeddingsModels(
        values.map((v) => ({ label: v, value: v }))
      );
    },
    [actions]
  );

  return (
    <VStack width="full" gap={4} paddingTop={4}>
      <ModelTagsInput
        label="Models"
        placeholder="Add custom model"
        values={modelValues}
        options={modelOptions}
        onValuesChange={handleModelsChange}
      />
      <ModelTagsInput
        label="Embeddings Models"
        placeholder="Add custom embeddings model"
        values={embeddingsValues}
        options={embeddingsOptions}
        onValuesChange={handleEmbeddingsChange}
      />
    </VStack>
  );
};
