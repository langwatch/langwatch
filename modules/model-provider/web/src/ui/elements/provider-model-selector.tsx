import { Box, createListCollection, Field, HStack, Input, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { modelProviderIcons } from "./modelProviders/icons-map.tsx";
import { modelDisplayLabel } from "@langwatch/model-provider-contract";
import { isLatestAlias, resolveLatestAlias } from "@langwatch/model-provider-contract";
import { titleCase } from "@langwatch/design-system/string-casing";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "@langwatch/prompt-web/surfaces/llm-config-constants";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Select } from "@langwatch/design-system/select";

type ModelOption = {
  label: string;
  value: string;
  icon: React.ReactNode;
  /** Optional second line under the label. Used to surface what an alias
   *  like `openai/latest` currently resolves to. */
  subtitle?: string;
};

type GroupedModelOptions = {
  provider: string;
  icon: React.ReactNode;
  models: ModelOption[];
}[];

/** Sentinel value emitted when the user picks the "Inherit" entry. The
 *  caller maps this back to "clear the override" (which writes nothing
 *  to the saved JSON, so the cascade walks up). */
export const INHERIT_SENTINEL = "__inherit__";

/** Keeps a group's models whose label or value matches `search` (case-insensitive). */
function filterGroupModels(group: GroupedModelOptions[number], search: string): ModelOption[] {
  const needle = search.toLowerCase();
  return group.models.filter(
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

function iconSlotFor(size: SelectorSize): string {
  return size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE;
}

function labelFontSize(size: SelectorSize): number {
  return size === "sm" ? 12 : 14;
}

/**
 * Alias entries (`<provider>/latest`, `<provider>/latest-mini`) read as
 * "Latest" / "Latest smaller model" with the resolved id as a subtitle, so
 * the picker shows what the pick would actually get.
 */
function toModelOption({
  displayNames,
  modelValue,
}: {
  displayNames: Record<string, string> | undefined;
  modelValue: string;
}): ModelOption {
  const modelProvider = modelValue.split("/")[0] ?? "";
  const icon = modelProviderIcons[modelProvider as keyof typeof modelProviderIcons];
  if (!isLatestAlias(modelValue)) {
    return {
      label: modelDisplayLabel({ fullModelId: modelValue, displayNames }),
      value: modelValue,
      icon,
      subtitle: "",
    };
  }

  const suffix = modelValue.split("/")[1] ?? "";

  return {
    label: suffix === "latest" ? "Latest" : "Latest smaller model",
    value: modelValue,
    icon,
    subtitle: resolveLatestAlias(modelValue) ?? "",
  };
}

function groupOptionsByProvider(selectOptions: ModelOption[]): GroupedModelOptions {
  const byProvider: Record<string, ModelOption[]> = {};
  for (const option of selectOptions) {
    const provider = option.value.split("/")[0]!;
    byProvider[provider] ??= [];
    byProvider[provider].push(option);
  }

  return Object.entries(byProvider).map(([provider, models]) => ({
    provider,
    icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
    models,
  }));
}

/**
 * The inherit placeholder in the trigger: the inherited model's icon and
 * family at reduced opacity, so an unpicked field reads as "this is what you
 * get if you do not override" rather than as an empty selector.
 */
function InheritValueText({
  displayNames,
  inheritIcon,
  inheritOption,
  size,
}: {
  displayNames?: Record<string, string>;
  inheritIcon: React.ReactNode;
  inheritOption: { label: string; model?: string };
  size: SelectorSize;
}) {
  const inheritedModel = inheritOption.model;

  return (
    <HStack overflow="hidden" gap={2} align="center" opacity={0.55}>
      {inheritIcon && <Box minWidth={iconSlotFor(size)}>{inheritIcon}</Box>}
      <Box
        fontSize={labelFontSize(size)}
        fontFamily={inheritedModel ? "mono" : undefined}
        lineClamp={1}
        wordBreak="break-all"
      >
        {inheritedModel
          ? modelDisplayLabel({ fullModelId: inheritedModel, displayNames })
          : inheritOption.label}
      </Box>
    </HStack>
  );
}

function SelectedValueText({
  displayNames,
  isUnknown,
  model,
  selectedIcon,
  selectedLabel,
  size,
}: {
  displayNames?: Record<string, string>;
  isUnknown: boolean;
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
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isUnknown ? "gray.500" : undefined}
      >
        {selectedLabel ?? modelDisplayLabel({ fullModelId: model, displayNames })}
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
  displayNames,
  inheritIcon,
  inheritItem,
  label,
  model,
}: {
  displayNames?: Record<string, string>;
  inheritIcon: React.ReactNode;
  inheritItem: ModelOption;
  label: string;
  model?: string;
}) {
  return (
    <Select.Item item={inheritItem} data-testid="provider-model-selector-inherit">
      <HStack gap={2}>
        {inheritIcon && (
          <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
            {inheritIcon}
          </Box>
        )}
        <Box>
          <Text fontSize="sm" fontWeight="medium">
            {label}
          </Text>
          {model && (
            <Text fontSize="xs" color="fg.muted" fontFamily="mono" lineClamp={1}>
              {modelDisplayLabel({ fullModelId: model, displayNames })}
            </Text>
          )}
        </Box>
      </HStack>
    </Select.Item>
  );
}

/**
 * Two-line alias items keep icon and label on one HStack so the icon anchors
 * to the label line; the resolved-id subtitle wraps under the text column,
 * indented past the icon slot.
 */
function ModelItem({ item, size }: { item: ModelOption; size: SelectorSize }) {
  return (
    <Select.Item item={item}>
      <Box>
        <HStack gap={2} align="center">
          {item.icon && (
            <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
              {item.icon}
            </Box>
          )}
          <Box
            fontSize={labelFontSize(size)}
            fontFamily={item.subtitle ? undefined : "mono"}
            fontWeight={item.subtitle ? "medium" : undefined}
            paddingY={size === "sm" ? 0 : "2px"}
          >
            {item.label}
          </Box>
        </HStack>
        {item.subtitle && (
          <Text
            fontSize="xs"
            color="fg.muted"
            fontFamily="mono"
            lineClamp={1}
            paddingLeft={`calc(${MODEL_ICON_SIZE} + var(--chakra-spacing-2))`}
          >
            {item.subtitle}
          </Text>
        )}
      </Box>
    </Select.Item>
  );
}

function ModelItemGroup({
  group,
  size,
}: {
  group: GroupedModelOptions[number];
  size: SelectorSize;
}) {
  return (
    <Select.ItemGroup
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
        <ModelItem key={item.value} item={item} size={size} />
      ))}
    </Select.ItemGroup>
  );
}

/**
 * Model selector across providers, grouped by provider icon (from each model's prefix).
 * `inheritOption`, when set, prepends an "Inherit" entry that emits `INHERIT_SENTINEL` on pick,
 * and renders as a faint placeholder when `model` is empty.
 */
export const ProviderModelSelector = React.memo(function ProviderModelSelector({
  model,
  options,
  onChange,
  size = "full",
  disabled = false,
  inheritOption,
  displayNames,
}: {
  model: string;
  options: string[];
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
    /** Short label shown above the model, e.g. "Inherit (from organization)" or "Not configured". */
    label: string;
  };
  /** Configured custom-model display names, keyed by `<provider>/<modelId>`.
   *  Falls back to the id-derived label for any model without an entry. */
  displayNames?: Record<string, string>;
}) {
  const [modelSearch, setModelSearch] = useState("");

  // Create model options with labels and derive icon from each model's provider.
  // Alias entries (`<provider>/latest`, `<provider>/latest-mini`) get a
  // human-readable label so the picker reads as "Latest" / "Latest smaller"
  // instead of the raw alias suffix, plus they carry the resolved model id
  // as a subtitle so the user sees what they'd actually get.
  const selectOptions = useMemo(
    () => options.map((modelValue) => toModelOption({ displayNames, modelValue })),
    [options, displayNames],
  );

  const groupedByProvider: GroupedModelOptions = useMemo(
    () => groupOptionsByProvider(selectOptions),
    [selectOptions],
  );

  // Filter models by search and group by provider
  const filteredGroups = useMemo(
    () =>
      groupedByProvider
        .map((group) => ({
          ...group,
          models: filterGroupModels(group, modelSearch),
        }))
        .filter((group) => group.models.length > 0),
    [groupedByProvider, modelSearch],
  );

  // Render the inherit placeholder in the trigger when the user hasn't
  // picked anything. Uses the inherited model's icon + family at 0.55
  // opacity so it reads as "this is what you'd get if you don't
  // override" instead of an empty / broken selector.
  const inheritIcon = inheritOption?.model
    ? modelProviderIcons[inheritOption.model.split("/")[0] as keyof typeof modelProviderIcons]
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
    ...filteredGroups.flatMap((group) => group.models),
  ];

  const modelCollection = createListCollection({
    items: allFilteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);
  const selectedIcon =
    selectedItem?.icon ??
    modelProviderIcons[model.split("/")[0] as keyof typeof modelProviderIcons];
  const isUnknown = !!model && !selectedItem;

  const showInheritPlaceholder = !model && inheritOption;
  const selectValueText = showInheritPlaceholder ? (
    <InheritValueText
      displayNames={displayNames}
      inheritIcon={inheritIcon}
      inheritOption={inheritOption}
      size={size}
    />
  ) : (
    <SelectedValueText
      displayNames={displayNames}
      isUnknown={isUnknown}
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
          // Inherit sentinel rides the same callback as a normal pick;
          // the caller maps `INHERIT_SENTINEL` to "clear the key" so the
          // cascade walks up. Direct model pick stays an exact-value
          // write.
          onChange(selectedValue);
        }
      }}
      loopFocus={true}
      highlightedValue={highlightedValue}
      onHighlightChange={(details) => {
        setHighlightedValue(details.highlightedValue);
      }}
      size={SELECT_SIZES[size]}
      disabled={disabled}
    >
      <Select.Trigger
        className="fix-hidden-inputs"
        width={TRIGGER_WIDTHS[size]}
        background="bg.panel"
        padding={0}
      >
        <Select.ValueText placeholder={selectValueText}>{() => selectValueText}</Select.ValueText>
      </Select.Trigger>
      <Select.Content padding={1}>
        <Field.Root asChild>
          <Box
            position="sticky"
            top={0}
            zIndex="1"
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
        {inheritOption && inheritItem && (
          <InheritItem
            displayNames={displayNames}
            inheritIcon={inheritIcon}
            inheritItem={inheritItem}
            label={inheritOption.label}
            model={inheritOption.model}
          />
        )}
        {filteredGroups.map((group) => (
          <ModelItemGroup key={group.provider} group={group} size={size} />
        ))}
      </Select.Content>
    </Select.Root>
  );
});
