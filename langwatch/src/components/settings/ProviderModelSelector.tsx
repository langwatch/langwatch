import {
  Box,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
} from "@chakra-ui/react";
import { Search } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import {
  isLatestAlias,
  resolveLatestAlias,
} from "../../server/modelProviders/latestAliases";
import { titleCase } from "../../utils/stringCasing";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "../llmPromptConfigs/constants";
import { InputGroup } from "../ui/input-group";
import { Select } from "../ui/select";

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

/**
 * A model selector that supports models from multiple providers.
 * Derives the provider icon from each model's prefix (e.g., "openai/gpt-4" -> openai icon).
 * Groups models by provider for better organization.
 * Used in the model provider settings form to select default models.
 *
 * `inheritOption` (optional) prepends a special "Inherit" entry at the
 * top of the dropdown. When the user picks it, `onChange` is called
 * with `INHERIT_SENTINEL`; the parent translates that to "clear the
 * key from in-progress state". When `model` is empty AND
 * `inheritOption` is set, the trigger renders the inherited model
 * label at 0.55 opacity as a placeholder so the user can see what the
 * cascade would resolve to.
 */
export const ProviderModelSelector = React.memo(function ProviderModelSelector({
  model,
  options,
  onChange,
  size = "full",
  disabled = false,
  inheritOption,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  disabled?: boolean;
  inheritOption?: {
    /** Model identifier the cascade would resolve to. Rendered with the provider icon. */
    model: string;
    /** Short label shown above the model, e.g. "Inherit (from organization)" or "Suggested from openai". */
    label: string;
  };
}) {
  const [modelSearch, setModelSearch] = useState("");

  // Create model options with labels and derive icon from each model's provider.
  // Alias entries (`<provider>/latest`, `<provider>/latest-mini`) get a
  // human-readable label so the picker reads as "Latest" / "Latest smaller"
  // instead of the raw alias suffix, plus they carry the resolved model id
  // as a subtitle so the user sees what they'd actually get.
  const selectOptions = useMemo(
    () =>
      options.map((modelValue) => {
        const modelProvider = modelValue.split("/")[0] ?? "";
        const icon =
          modelProviderIcons[modelProvider as keyof typeof modelProviderIcons];
        if (isLatestAlias(modelValue)) {
          const suffix = modelValue.split("/")[1] ?? "";
          const aliasLabel =
            suffix === "latest" ? "Latest" : "Latest smaller model";
          const resolved = resolveLatestAlias(modelValue);
          return {
            label: aliasLabel,
            value: modelValue,
            icon,
            subtitle: resolved ?? "",
          };
        }
        return {
          label: modelValue.split("/").slice(1).join("/"),
          value: modelValue,
          icon,
          subtitle: "",
        };
      }),
    [options],
  );

  // Group models by provider
  const groupedByProvider: GroupedModelOptions = useMemo(
    () =>
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
          {} as Record<string, ModelOption[]>,
        ),
      ).map(([provider, models]) => ({
        provider,
        icon: modelProviderIcons[provider as keyof typeof modelProviderIcons],
        models,
      })),
    [selectOptions],
  );

  // Filter models by search and group by provider
  const filteredGroups = useMemo(
    () =>
      groupedByProvider
        .map((group) => ({
          ...group,
          models: group.models.filter(
            (item) =>
              item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
              item.value.toLowerCase().includes(modelSearch.toLowerCase()),
          ),
        }))
        .filter((group) => group.models.length > 0),
    [groupedByProvider, modelSearch],
  );

  // Render the inherit placeholder in the trigger when the user hasn't
  // picked anything. Uses the inherited model's icon + family at 0.55
  // opacity so it reads as "this is what you'd get if you don't
  // override" instead of an empty / broken selector.
  const inheritIcon = inheritOption
    ? modelProviderIcons[
        inheritOption.model.split("/")[0] as keyof typeof modelProviderIcons
      ]
    : null;

  // Flatten for collection. When an inherit option is present we MUST
  // include it as a collection item — Chakra's Select uses the
  // collection for keyboard nav, click-to-select, and hover highlight.
  // Rendering a Select.Item whose value isn't in the collection makes
  // it look interactive but silently un-selectable (hover stays on the
  // first real item below it).
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

  const selectValueText = !model && inheritOption ? (
    <HStack overflow="hidden" gap={2} align="center" opacity={0.55}>
      {inheritIcon && (
        <Box minWidth={size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE}>
          {inheritIcon}
        </Box>
      )}
      <Box
        fontSize={size === "sm" ? 12 : 14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
      >
        {inheritOption.model.split("/").slice(1).join("/")}
      </Box>
    </HStack>
  ) : (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedIcon && (
        <Box minWidth={size === "sm" ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE}>
          {selectedIcon}
        </Box>
      )}
      <Box
        fontSize={size === "sm" ? 12 : 14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isUnknown ? "gray.500" : undefined}
      >
        {selectedItem?.label ?? model.split("/").slice(1).join("/")}
      </Box>
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(
    model,
  );

  useEffect(() => {
    const highlightedItem = modelCollection.items.find(
      (item) => item.value === highlightedValue,
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
      size={size === "full" ? undefined : size}
      disabled={disabled}
    >
      <Select.Trigger
        className="fix-hidden-inputs"
        width={size === "full" ? "100%" : "auto"}
        background="bg.panel"
        padding={0}
      >
        <Select.ValueText placeholder={selectValueText}>
          {() => selectValueText}
        </Select.ValueText>
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
            <InputGroup
              startElement={<Search size={16} />}
              startOffset="-4px"
              width="full"
            >
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
          // Free-standing item at the top of the dropdown — no group
          // wrapper, no label. The prior "Cascade" group header was
          // jargon ("cascade" is implementation talk, not a thing
          // users think about); leaving the Inherit row to read on
          // its own is enough context.
          <Select.Item
            item={inheritItem}
            data-testid="provider-model-selector-inherit"
          >
            <HStack gap={2}>
              {inheritIcon && (
                <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
                  {inheritIcon}
                </Box>
              )}
              <Box>
                <Text fontSize="sm" fontWeight="medium">
                  {inheritOption.label}
                </Text>
                <Text
                  fontSize="xs"
                  color="fg.muted"
                  fontFamily="mono"
                  lineClamp={1}
                >
                  {inheritOption.model.split("/").slice(1).join("/")}
                </Text>
              </Box>
            </HStack>
          </Select.Item>
        )}
        {filteredGroups.map((group) => (
          <Select.ItemGroup
            key={group.provider}
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
              <Select.Item key={item.value} item={item}>
                {/* Two-line alias items keep icon + label on the same
                    HStack so the icon visually anchors to the label
                    line. The resolved-id subtitle wraps under the
                    text column, indented past the icon slot so the
                    column reads cleanly. */}
                <Box>
                  <HStack gap={2} align="center">
                    {item.icon && (
                      <Box width={MODEL_ICON_SIZE} minWidth={MODEL_ICON_SIZE}>
                        {item.icon}
                      </Box>
                    )}
                    <Box
                      fontSize={size === "sm" ? 12 : 14}
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
            ))}
          </Select.ItemGroup>
        ))}
      </Select.Content>
    </Select.Root>
  );
});
