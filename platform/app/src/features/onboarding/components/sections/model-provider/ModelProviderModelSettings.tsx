import {
  Combobox,
  Field,
  NativeSelect,
  TagsInput,
  useCombobox,
  useFilter,
  useListCollection,
  useTagsInput,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { CustomModelEntry } from "../../../../../server/modelProviders/customModel.schema";
import type { ModelProviderKey } from "../../../regions/model-providers/types";

type ModelOption = { label: string; value: string };

interface ModelProviderModelSettingsProps {
  modelProviderKey: ModelProviderKey;
  customModels: CustomModelEntry[];
  chatModelOptions?: ModelOption[];
  defaultModel: string | null;
  onCustomModelsChange: (models: CustomModelEntry[]) => void;
  onDefaultModelChange: (model: string | null) => void;
}

export const ModelProviderModelSettings: React.FC<
  ModelProviderModelSettingsProps
> = ({
  modelProviderKey,
  customModels,
  chatModelOptions,
  defaultModel,
  onCustomModelsChange,
  onDefaultModelChange,
}: ModelProviderModelSettingsProps) => {
  const inputId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);

  const customModelValues = useMemo(
    () => (customModels ?? []).map((model) => model.modelId),
    [customModels],
  );

  useEffect(() => {
    if (defaultModel && !customModelValues.includes(defaultModel)) {
      onDefaultModelChange(null);
    }
  }, [customModelValues, defaultModel, onDefaultModelChange]);

  const allChatModelItems = useMemo(() => {
    const existing = new Set<string>();
    (chatModelOptions ?? []).forEach((option) => {
      if (option?.value) existing.add(option.value);
    });
    customModelValues.forEach((value) => {
      if (value) existing.add(value);
    });
    return Array.from(existing);
    // We have the model provider key as a dependency because the chat model options are
    // different for each model provider, and this forces a re-render when the provider
    // changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelProviderKey, chatModelOptions, customModelValues]);

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: allChatModelItems,
    filter: contains,
  });

  const handleTagsValueChange = useCallback(
    (details: { value: string[] }) => {
      onCustomModelsChange(
        details.value.map((value) => ({
          modelId: value,
          displayName: value,
          mode: "chat" as const,
        })),
      );
    },
    [onCustomModelsChange],
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
    [filter],
  );

  const handleComboboxValueChange = useCallback(
    (event: { value?: string[] }) => {
      const nextValue = event.value?.[0];
      if (!nextValue) return;
      if (!customModelValues.includes(nextValue)) {
        tags.addValue(nextValue);
      }
    },
    [customModelValues, tags],
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

  const availableCollectionItems = useMemo(() => {
    const items = (collection.items as string[] | undefined) ?? [];
    return items.filter((item) => !tags.value.includes(item));
  }, [collection.items, tags.value]);

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root>
        <Combobox.RootProvider value={combobox}>
          <TagsInput.RootProvider value={tags} variant="flushed" size="sm">
            <TagsInput.Label>Allowed Chat Models</TagsInput.Label>
            <TagsInput.Control ref={controlRef}>
              {tags.value.map((tag, index) => (
                <TagsInput.Item key={index} index={index} value={tag}>
                  <TagsInput.ItemPreview
                    bg="bg.emphasized/40"
                    backdropBlur="md"
                    border="border.subtle"
                    borderRadius="md"
                  >
                    <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                    <TagsInput.ItemDeleteTrigger />
                  </TagsInput.ItemPreview>
                  <TagsInput.ItemInput />
                </TagsInput.Item>
              ))}
              <Combobox.Input unstyled asChild>
                <TagsInput.Input placeholder="Add custom chat model..." />
              </Combobox.Input>
            </TagsInput.Control>
            <Field.HelperText>
              Pre-populated with known models. Remove or add as needed. You can
              update this later in the model provider settings.
            </Field.HelperText>
            <TagsInput.HiddenInput />
            <Combobox.Positioner>
              <Combobox.Content
                bg="bg.muted/40"
                backdropFilter="blur(10px)"
                borderRadius="md"
              >
                <Combobox.Empty>No chat models found</Combobox.Empty>
                {availableCollectionItems.map((item) => (
                  <Combobox.Item
                    item={item}
                    key={item}
                    borderRadius="md"
                    bg="none"
                    _hover={{
                      bg: "bg.subtle/30",
                    }}
                  >
                    <Combobox.ItemText>{item}</Combobox.ItemText>
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                ))}
              </Combobox.Content>
            </Combobox.Positioner>
          </TagsInput.RootProvider>
        </Combobox.RootProvider>
      </Field.Root>

      <Field.Root>
        <Field.Label>Default Chat Model</Field.Label>
        <NativeSelect.Root size="sm" bg="bg.muted/40">
          <NativeSelect.Field
            value={defaultModel ?? ""}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              onDefaultModelChange(event.target.value || null)
            }
          >
            <option value="">Select default model...</option>
            {customModelValues.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Field.HelperText>
          This model will be used for evaluations, prompt optimization, and
          dataset generation. Change this anytime in the model provider
          settings.
        </Field.HelperText>
      </Field.Root>
    </VStack>
  );
};
