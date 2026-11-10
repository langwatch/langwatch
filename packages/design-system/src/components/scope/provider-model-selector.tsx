import { Search } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";

import { Box, createListCollection, Field, HStack, Input, Text } from "../../primitives.ts";
import { InputGroup } from "../forms/input-group.tsx";
import { scrollToListItem, Select } from "../forms/select.tsx";
import { inferProvider, ProviderIconGlyph } from "./provider-icons.tsx";

const MODEL_ICON_SIZE = "16px";
const MODEL_ICON_SIZE_SM = "14px";

/** What a picker entry says and picks; the icon is drawn from the provider prefix of `value`. */
export type ModelPickerOption = {
  label: string;
  value: string;
  /** One line under the title, cut with an ellipsis. */
  subtitle?: string;
  /** Listed and described, but not pickable. */
  disabled?: boolean;
  /** A short tag at the end of the title line, such as "Coming soon". */
  hint?: string;
};

/** A query result: the options, whether they are still loading, and why they failed. */
export type ModelPickerQuery = {
  data: ModelPickerOption[] | undefined;
  isLoading: boolean;
  error?: unknown;
};

type ModelOption = ModelPickerOption & { icon: React.ReactNode };

/** Sentinel value emitted when the user picks the "Inherit" entry. The
 *  caller maps this back to "clear the override" (which writes nothing
 *  to the saved JSON, so the cascade walks up). */
export const INHERIT_SENTINEL = "__inherit__";

/** Keeps the options whose label or value matches `search` (case-insensitive). */
function filterModels(models: ModelOption[], search: string): ModelOption[] {
  const needle = search.toLowerCase();
  return models.filter(
    (item) =>
      item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle),
  );
}

type SelectorSize = "sm" | "md" | "full";

const TRIGGER_WIDTHS: Record<SelectorSize, string> = {
  full: "100%",
  sm: "auto",
  md: "auto",
};

/** Chakra's Select has no "full" size; the width carries that instead. */
const SELECT_SIZES: Record<SelectorSize, "sm" | "md" | undefined> = {
  full: undefined,
  sm: "sm",
  md: "md",
};

/** The dark-safe provider mark for a model id, prefixed (`openai/gpt-5`) or bare (`gpt-5`). */
function providerIconFor(model: string, size: string = MODEL_ICON_SIZE): React.ReactNode {
  const provider = inferProvider(model);
  return provider ? <ProviderIconGlyph provider={provider} size={size} /> : null;
}

function iconSlotFor(size: SelectorSize): string {
  return size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE;
}

function labelFontSize(size: SelectorSize): number {
  return size === "sm" ? 12 : 14;
}

/**
 * The inherit placeholder in the trigger: the inherited model's icon and
 * family at reduced opacity, so an unpicked field reads as "this is what you
 * get if you do not override" rather than as an empty selector.
 */
function InheritValueText({
  labelFor,
  inheritIcon,
  inheritOption,
  isModelId,
  size,
}: {
  labelFor: (modelId: string) => string;
  inheritIcon: React.ReactNode;
  inheritOption: { label: string; model?: string };
  /** A bare model id reads in mono; a named entry such as a decision model does not. */
  isModelId: boolean;
  size: SelectorSize;
}) {
  const inheritedModel = inheritOption.model;

  return (
    <HStack overflow="hidden" gap={2} align="center" opacity={0.55}>
      {inheritIcon && <Box minWidth={iconSlotFor(size)}>{inheritIcon}</Box>}
      <Box
        fontSize={labelFontSize(size)}
        fontFamily={inheritedModel && isModelId ? "mono" : undefined}
        lineClamp={1}
        wordBreak="break-all"
      >
        {inheritedModel ? labelFor(inheritedModel) : inheritOption.label}
      </Box>
    </HStack>
  );
}

function SelectedValueText({
  labelFor,
  isUnknown,
  isModelId,
  model,
  selectedIcon,
  selectedLabel,
  size,
}: {
  labelFor: (modelId: string) => string;
  isUnknown: boolean;
  isModelId: boolean;
  model: string;
  selectedIcon: React.ReactNode;
  selectedLabel: string | undefined;
  size: SelectorSize;
}) {
  return (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedIcon && <Box minWidth={iconSlotFor(size)}>{selectedIcon}</Box>}
      <Box
        fontSize={labelFontSize(size)}
        fontFamily={isModelId ? "mono" : undefined}
        lineClamp={1}
        wordBreak="break-all"
        color={isUnknown ? "gray.500" : undefined}
      >
        {selectedLabel ?? labelFor(model)}
      </Box>
    </HStack>
  );
}

/**
 * A free-standing row at the top of the dropdown, with no group wrapper and
 * no label. The prior "Cascade" header was implementation jargon; the Inherit
 * row reads well enough on its own.
 */
function InheritItem({
  labelFor,
  inheritIcon,
  inheritItem,
  label,
  model,
}: {
  labelFor: (modelId: string) => string;
  inheritIcon: React.ReactNode;
  inheritItem: ModelOption;
  label: string;
  model?: string;
}) {
  return (
    <Select.Item
      item={inheritItem}
      data-testid="provider-model-selector-inherit"
      paddingY={1.5}
      flexShrink={0}
    >
      <HStack gap={2.5} minWidth={0} flex={1}>
        {inheritIcon && (
          <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
            {inheritIcon}
          </Box>
        )}
        <Box minWidth={0} flex={1}>
          <Text fontSize="sm" fontWeight="medium" lineHeight="short" truncate>
            {label}
          </Text>
          {model && (
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" lineHeight="short" truncate>
              {labelFor(model)}
            </Text>
          )}
        </Box>
      </HStack>
    </Select.Item>
  );
}

/**
 * One row: the provider icon, then a title and, when given, a one-line description cut with an
 * ellipsis. A described row is a named entry (a decision model, an alias) and reads in the body
 * font; a bare model id reads in mono.
 */
function ModelItem({ item, size }: { item: ModelOption; size: SelectorSize }) {
  const isDescribed = !!item.subtitle;
  const hint = item.hint ? (
    <Text
      fontSize="2xs"
      color="fg.subtle"
      flexShrink={0}
      marginStart="auto"
      whiteSpace="nowrap"
      data-testid="model-option-hint"
    >
      {item.hint}
    </Text>
  ) : null;
  return (
    <Select.Item
      item={item}
      paddingY={isDescribed ? 1.5 : undefined}
      // The list is a capped flex column; a row that shrinks would clip its second line.
      flexShrink={0}
      // An unpickable row stays readable: its line says how to enable it.
      _disabled={{ opacity: 1, cursor: "not-allowed" }}
    >
      <HStack gap={2.5} align="center" minWidth={0} flex={1}>
        {item.icon && (
          <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
            {item.icon}
          </Box>
        )}
        <Box minWidth={0} flex={1}>
          <HStack gap={2} minWidth={0}>
            <Text
              fontSize={labelFontSize(size)}
              fontFamily={isDescribed ? undefined : "mono"}
              fontWeight={isDescribed ? "medium" : undefined}
              paddingY={size === "sm" || isDescribed ? 0 : "2px"}
              lineHeight="short"
              truncate
            >
              {item.label}
            </Text>
            {hint}
          </HStack>
          {isDescribed && (
            <HStack gap={2} minWidth={0}>
              <Text
                fontSize="xs"
                lineHeight="short"
                color="fg.muted"
                truncate
                data-testid="model-option-subtitle"
              >
                {item.subtitle}
              </Text>
            </HStack>
          )}
        </Box>
      </HStack>
    </Select.Item>
  );
}

/**
 * One flat list in the caller's order, each row with its provider icon, so no headings.
 * `inheritOption` adds an "Inherit" entry (emits `INHERIT_SENTINEL`) on top, faint when unset.
 */
export function ProviderModelSelector({
  model,
  query,
  onChange,
  size = "full",
  disabled = false,
  inheritOption,
  labelFor = (modelId) => modelId,
}: {
  model: string;
  /** The options as a query result; the caller fetches, this only draws. */
  query: ModelPickerQuery;
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  disabled?: boolean;
  inheritOption?: {
    /** Model identifier the cascade would resolve to, rendered with the
     *  provider icon. Absent when nothing wider carries a value (or the
     *  widest scope is being edited): the entry then reads as its label
     *  alone, still selectable so a pinned key can be cleared back to
     *  inherit. */
    model?: string;
    /** Short label above the model, e.g. "Inherit (from organization)" or "Not configured". */
    label: string;
  };
  /** Label for a model id not among the options (a value saved before its provider went). */
  labelFor?: (modelId: string) => string;
}) {
  const [modelSearch, setModelSearch] = useState("");

  // Each option carries the icon of its provider prefix.
  const withIcon = (option: ModelPickerOption): ModelOption => ({
    ...option,
    icon: providerIconFor(option.value, iconSlotFor(size)),
  });
  const selectOptions = (query.data ?? []).map(withIcon);
  const filteredModels = filterModels(selectOptions, modelSearch);
  const isModelId = (id: string) => !selectOptions.find((option) => option.value === id)?.subtitle;

  // Render the inherit placeholder in the trigger when the user hasn't
  // picked anything. Uses the inherited model's icon + family at 0.55
  // opacity so it reads as "this is what you'd get if you don't
  // override" instead of an empty / broken selector.
  const inheritIcon = inheritOption?.model
    ? providerIconFor(inheritOption.model, iconSlotFor(size))
    : null;

  // The inherit option must be in the collection: Chakra's Select uses it
  // for keyboard nav and hover, so an item outside it looks interactive but
  // is silently un-selectable.
  const inheritItem: ModelOption | null = inheritOption
    ? {
        value: INHERIT_SENTINEL,
        label: inheritOption.label,
        icon: inheritIcon,
      }
    : null;
  const allFilteredModels: ModelOption[] = [
    ...(inheritItem ? [inheritItem] : []),
    ...filteredModels,
  ];

  const modelCollection = createListCollection({
    items: allFilteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);
  const selectedIcon = selectedItem?.icon ?? providerIconFor(model, iconSlotFor(size));
  const isUnknown = !!model && !selectedItem;

  const showInheritPlaceholder = !model && inheritOption;
  const selectValueText = showInheritPlaceholder ? (
    <InheritValueText
      labelFor={labelFor}
      inheritIcon={inheritIcon}
      inheritOption={inheritOption}
      isModelId={!inheritOption.model || isModelId(inheritOption.model)}
      size={size}
    />
  ) : (
    <SelectedValueText
      labelFor={labelFor}
      isUnknown={isUnknown}
      isModelId={isModelId(model)}
      model={model}
      selectedIcon={selectedIcon}
      selectedLabel={selectedItem?.label}
      size={size}
    />
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(model);

  useEffect(() => {
    const highlightedItem = modelCollection.items.find((item) => item.value === highlightedValue);
    if (!highlightedItem) {
      setHighlightedValue(modelCollection.items[0]?.value ?? null);
    }
  }, [highlightedValue, modelCollection.items]);

  return (
    <>
      <Select.Root
        collection={modelCollection}
        value={[model]}
        onChange={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        // Every pick reaches the caller, the ticked row included, so a value shown by default can
        // be stored. `INHERIT_SENTINEL` rides the same callback; the caller maps it to a clear.
        onSelect={({ value: selectedValue }) => {
          if (selectedValue) onChange(selectedValue);
        }}
        loopFocus={true}
        scrollToIndexFn={scrollToListItem}
        // A narrow trigger still opens a list wide enough for a title, its tag and a full line.
        positioning={{ sameWidth: false }}
        highlightedValue={highlightedValue}
        onHighlightChange={(details) => {
          setHighlightedValue(details.highlightedValue);
        }}
        size={SELECT_SIZES[size]}
        disabled={disabled || query.isLoading}
      >
        <Select.Trigger
          className="fix-hidden-inputs"
          width={TRIGGER_WIDTHS[size]}
          background="bg.panel"
          padding={0}
        >
          <Select.ValueText placeholder={selectValueText}>{() => selectValueText}</Select.ValueText>
        </Select.Trigger>
        <Select.Content
          padding={1}
          minWidth="max(var(--reference-width), 20rem)"
          maxWidth="min(28rem, calc(100vw - 2rem))"
          // Only the rows scroll, below the search, so none passes behind it.
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
              <InputGroup startElement={<Search size={16} />} startOffset="-4px" width="full">
                <Input
                  size="sm"
                  placeholder="Search models"
                  type="search"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  border="none"
                  _focus={{ boxShadow: "none" }}
                  _focusVisible={{
                    outline: "2px solid",
                    outlineColor: "colorPalette.focusRing",
                    outlineOffset: "1px",
                    borderRadius: "sm",
                  }}
                  paddingX={2}
                />
              </InputGroup>
            </Box>
          </Field.Root>
          <Select.List data-testid="provider-model-selector-list">
            {inheritOption && inheritItem && (
              <InheritItem
                labelFor={labelFor}
                inheritIcon={inheritIcon}
                inheritItem={inheritItem}
                label={inheritOption.label}
                model={inheritOption.model}
              />
            )}
            {filteredModels.map((item) => (
              <ModelItem key={item.value} item={item} size={size} />
            ))}
          </Select.List>
        </Select.Content>
      </Select.Root>
      {query.error ? (
        <Text fontSize="xs" color="red.fg" data-testid="provider-model-selector-error">
          Could not load the models for this project.
        </Text>
      ) : null}
    </>
  );
}
