import { useState } from "react";

import { Box, createListCollection, Field, HStack, Text, Wrap } from "../../primitives.ts";
import { scrollToListItem, Select } from "../forms/select.tsx";
import {
  filterModels,
  ModelItem,
  type ModelOption,
  ModelSearchField,
  type ModelPickerOption,
  type ModelPickerQuery,
  providerIconFor,
} from "./provider-model-selector.tsx";

/** A picked model no option offers any more (its provider went), kept so it can be unpicked. */
const UNAVAILABLE_HINT = "Not connected";

/** One picked model in the trigger: its provider mark and its name. */
function PickedModel({ option }: { option: ModelOption }) {
  return (
    <HStack
      gap={1}
      paddingX={1.5}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      fontSize="xs"
      maxWidth="full"
      opacity={option.hint ? 0.6 : 1}
    >
      {option.icon}
      <Text fontFamily="mono" truncate>
        {option.label}
      </Text>
    </HStack>
  );
}

/**
 * Several models from the configured providers, each with its icon, searchable. Nothing picked
 * reads as `emptyLabel`, which says what an empty list means where it is used. A picked model
 * no option offers stays listed, marked, so it can be unpicked.
 */
export function ProviderModelMultiSelector({
  models,
  query,
  onChange,
  emptyLabel,
  disabled = false,
  labelFor = (modelId) => modelId,
  "aria-label": ariaLabel,
}: {
  models: readonly string[];
  /** The options as a query result; the caller fetches, this only draws. */
  query: ModelPickerQuery;
  onChange: (models: string[]) => void;
  emptyLabel: string;
  disabled?: boolean;
  /** Label for a picked model id not among the options. */
  labelFor?: (modelId: string) => string;
  "aria-label"?: string;
}) {
  const [search, setSearch] = useState("");
  const offered = query.data ?? [];
  const unavailable: ModelPickerOption[] = models
    .filter((model) => !offered.some((option) => option.value === model))
    .map((model) => ({ value: model, label: labelFor(model), hint: UNAVAILABLE_HINT }));
  const options: ModelOption[] = [...offered, ...unavailable].map((option) => ({
    ...option,
    icon: providerIconFor(option.value),
  }));
  const filtered = filterModels(options, search);
  const collection = createListCollection({ items: filtered });
  const picked = models.flatMap((model) => options.filter((option) => option.value === model));

  const toggle = (model: string) =>
    onChange(
      models.includes(model) ? models.filter((value) => value !== model) : [...models, model],
    );

  return (
    <>
      <Select.Root
        multiple
        collection={collection}
        value={[...models]}
        closeOnSelect={false}
        onSelect={({ value }) => {
          if (value) toggle(value);
        }}
        loopFocus={true}
        scrollToIndexFn={scrollToListItem}
        positioning={{ sameWidth: false }}
        disabled={disabled || query.isLoading}
      >
        <Select.Trigger
          className="fix-hidden-inputs"
          background="bg.panel"
          aria-label={ariaLabel}
          minHeight="10"
        >
          <Select.ValueText placeholder={emptyLabel}>
            {() =>
              picked.length > 0 ? (
                <Wrap gap={1.5} paddingY={1}>
                  {picked.map((option) => (
                    <PickedModel key={option.value} option={option} />
                  ))}
                </Wrap>
              ) : (
                <Text color="fg.muted">{emptyLabel}</Text>
              )
            }
          </Select.ValueText>
        </Select.Trigger>
        <Select.Content
          padding={1}
          minWidth="max(var(--reference-width), 20rem)"
          maxWidth="min(36rem, calc(100vw - 2rem))"
          overflow="hidden"
        >
          <Field.Root asChild>
            <Box
              flexShrink={0}
              background="bg.panel"
              paddingX={1}
              paddingY={1}
              borderBottom="1px solid"
              borderColor="border"
            >
              <ModelSearchField value={search} onChange={setSearch} />
            </Box>
          </Field.Root>
          <Select.List data-testid="provider-model-multi-selector-list">
            {filtered.map((item) => (
              <ModelItem key={item.value} item={item} size="md" />
            ))}
          </Select.List>
        </Select.Content>
      </Select.Root>
      {query.error ? (
        <Text fontSize="xs" color="red.fg" data-testid="provider-model-multi-selector-error">
          Could not load the models for this project.
        </Text>
      ) : null}
    </>
  );
}
