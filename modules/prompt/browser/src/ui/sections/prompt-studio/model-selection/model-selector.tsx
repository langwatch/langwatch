import {
  Box,
  Button,
  createListCollection,
  Field,
  HStack,
  Input,
  Skeleton,
  Text,
} from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Select } from "@langwatch/design-system/select";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AlertTriangle, Search } from "lucide-react";
import React, { useEffect, useState } from "react";
import { LuSettings2 } from "react-icons/lu";

import {
  type ModelOption,
  type ModelOptionGroup,
  useModelSelectionOptions,
} from "../../../../behavior/use-model-selection-options.ts";
import {
  MODEL_ICON_SIZE,
  MODEL_ICON_SIZE_SM,
} from "../../../../model/model-selection-constants.ts";
import { titleCase } from "../../../../model/string-casing.ts";
import { type modelProviderIcons, ProviderIconGlyph } from "./model-provider-icons.tsx";
import { NoModelsConfiguredCallout } from "./no-models-configured-callout.tsx";

type SelectorSize = "sm" | "md" | "full";

const SKELETON_WIDTHS: Record<SelectorSize, string> = {
  full: "full",
  sm: "180px",
  md: "240px",
};

/** The provider groups whose models match the search, dropping empty groups. */
function filterModelGroups({
  groups,
  search,
}: {
  groups: ModelOptionGroup[];
  search: string;
}): ModelOptionGroup[] {
  const needle = search.toLowerCase();
  return groups
    .map((group) => ({
      ...group,
      models: group.models.filter(
        (item) =>
          item.label.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.models.length > 0);
}

/**
 * The chosen model as the trigger shows it. A provider gone (deleted, or never
 * configured at a reachable scope) keeps the persisted value but asks for an
 * update, the same chip treatment the Default Models table gives it.
 */
function SelectedModelValue({
  model,
  selectedItem,
  groups,
  size,
}: {
  model: string;
  selectedItem: ModelOption | undefined;
  groups: ModelOptionGroup[];
  size: SelectorSize;
}) {
  const small = size === "sm";
  const providerKey = model.split("/")[0] ?? "";
  const isProviderMissing =
    !!model && !!providerKey && !groups.some((group) => group.provider === providerKey);
  const unknownColor = selectedItem ? undefined : "gray.500";

  return (
    <HStack overflow="hidden" gap={2} align="center">
      {selectedItem?.icon && (
        <ProviderIconGlyph
          provider={providerKey as keyof typeof modelProviderIcons}
          size={small ? MODEL_ICON_SIZE_SM : MODEL_ICON_SIZE}
        />
      )}
      <Box
        fontSize={small ? 12 : 14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
        color={isProviderMissing ? "red.600" : unknownColor}
        textDecoration={isProviderMissing ? "line-through" : undefined}
      >
        {selectedItem?.label ?? model}
      </Box>
      {isProviderMissing && <ProviderMissingBadge providerKey={providerKey} small={small} />}
    </HStack>
  );
}

function ProviderMissingBadge({ providerKey, small }: { providerKey: string; small: boolean }) {
  return (
    <Tooltip
      content={`${providerKey} provider isn't enabled here. Re-add the provider or pick a different model to use it.`}
      positioning={{ placement: "top" }}
      showArrow
    >
      <HStack gap={1} color="red.600" flexShrink={0}>
        <AlertTriangle size={small ? 12 : 14} aria-hidden />
        <Text
          fontSize={small ? "2xs" : "xs"}
          fontWeight="medium"
          textTransform="uppercase"
          letterSpacing="wide"
        >
          Update needed
        </Text>
      </HStack>
    </Tooltip>
  );
}

/** Keeps a highlighted model among the filtered ones as the search narrows them. */
function useHighlightedModel({
  model,
  filteredModels,
  search,
}: {
  model: string;
  filteredModels: ModelOption[];
  search: string;
}) {
  const [highlightedValue, setHighlightedValue] = useState<string | null>(model);

  useEffect(() => {
    if (filteredModels.some((item) => item.value === highlightedValue)) return;
    const firstValue = filteredModels[0]?.value ?? null;
    if (firstValue !== highlightedValue) setHighlightedValue(firstValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return { highlightedValue, setHighlightedValue };
}

/** One provider's models, custom ones first, with a divider before the registry ones. */
function ModelGroupItems({ group, size }: { group: ModelOptionGroup; size: SelectorSize }) {
  const hasCustom = group.models.some((m) => m.isCustom);
  const hasRegistry = group.models.some((m) => !m.isCustom);
  const small = size === "sm";

  return (
    <Select.ItemGroup
      key={group.provider}
      label={
        <HStack gap={2} paddingX={2}>
          <Text fontWeight="medium">{titleCase(group.provider)}</Text>
        </HStack>
      }
    >
      {group.models.map((item, itemIndex) => {
        const showDivider =
          hasCustom && hasRegistry && !item.isCustom && group.models[itemIndex - 1]?.isCustom;

        return (
          <React.Fragment key={item.value}>
            {showDivider && (
              <Box borderBottom="1px solid" borderColor="border" marginX={2} marginY={1} />
            )}
            <Select.Item item={item}>
              <HStack gap={2}>
                {item.icon && (
                  <ProviderIconGlyph
                    provider={item.value.split("/")[0] as keyof typeof modelProviderIcons}
                    size={MODEL_ICON_SIZE}
                  />
                )}
                <Box fontSize={small ? 12 : 14} fontFamily="mono" paddingY={small ? 0 : "2px"}>
                  {item.label}
                </Box>
              </HStack>
            </Select.Item>
          </React.Fragment>
        );
      })}
    </Select.ItemGroup>
  );
}

function ConfigureModelsAction({ size }: { size: SelectorSize }) {
  return (
    <Box
      position="sticky"
      bottom={0}
      bg="bg.panel"
      borderTop="1px solid"
      borderColor="border"
      zIndex="1"
    >
      <Button
        width="full"
        fontWeight="500"
        color="fg.muted"
        paddingY={5}
        justifyContent="flex-start"
        variant="ghost"
        colorPalette="gray"
        size="sm"
        borderRadius="none"
        asChild
      >
        <Link
          href="/settings/model-providers"
          isExternal
          _hover={{ textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          <LuSettings2 />
          <Text fontSize={size === "sm" ? 12 : 14}>Configure available models</Text>
        </Link>
      </Button>
    </Box>
  );
}

function ModelSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field.Root asChild>
      <Box position="sticky" top={0} zIndex="1">
        <InputGroup
          startElement={<Search size={16} />}
          startOffset="-4px"
          background="bg.panel"
          width="calc(100%)"
          paddingY={1}
          borderBottom="1px solid"
          borderColor="border"
        >
          <Input
            variant="flushed"
            size="sm"
            placeholder="Search models"
            type="search"
            background="transparent"
            color="fg"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </InputGroup>
      </Box>
    </Field.Root>
  );
}

export const ModelSelector = React.memo(function ModelSelector({
  model,
  options,
  onChange,
  size = "md",
  mode,
  showConfigureAction = false,
  forFeatureLabel,
  featureKey,
  open,
  onOpenChange,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  size?: "sm" | "md" | "full";
  mode?: "chat" | "embedding";
  /** The feature this picker serves, for the restricted-provider gate
   *  (`filterRestrictedModels`): a picker that names a codex-licensed
   *  feature (e.g. Langy's `langy.chat`) may offer codex models; one
   *  that names none never sees them. */
  featureKey?: string;
  /** When true, shows a "Configure available models" link at the bottom of the dropdown */
  showConfigureAction?: boolean;
  /** Surface-specific label used in the empty-state callout when no
   *  models are available - e.g. "for AI search", "for evaluators".
   *  Optional; the callout falls back to a generic message. */
  forFeatureLabel?: string;
  /** Controlled open state. Pass with onOpenChange to drive the dropdown
   *  from outside - e.g. force-close it when the parent collapses. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { selectOptions, groupedByProvider, isEmpty, isLoading } = useModelSelectionOptions({
    options,
    model,
    mode,
    opts: { featureKey },
  });

  // Every hook runs before the early returns below, so the hook order holds
  // when isEmpty flips between renders.
  const [modelSearch, setModelSearch] = useState("");
  const filteredGroups = filterModelGroups({ groups: groupedByProvider, search: modelSearch });
  // Flattened for the collection Chakra's Select needs.
  const allFilteredModels = filteredGroups.flatMap((group) => group.models);
  const { highlightedValue, setHighlightedValue } = useHighlightedModel({
    model,
    filteredModels: allFilteredModels,
    search: modelSearch,
  });

  // A skeleton while providers load, so the empty state does not flash.
  if (isLoading) {
    return (
      <Skeleton
        width={SKELETON_WIDTHS[size]}
        height={size === "sm" ? "28px" : "40px"}
        borderRadius="md"
      />
    );
  }

  // No models of this mode: a guided callout, never a gray fallback string
  // that looks selected and errors at runtime.
  if (isEmpty) {
    return <NoModelsConfiguredCallout size={size} forFeatureLabel={forFeatureLabel} />;
  }

  const selectValueText = (
    <SelectedModelValue
      model={model}
      selectedItem={selectOptions.find((option) => option.value === model)}
      groups={groupedByProvider}
      size={size}
    />
  );

  return (
    <Select.Root
      collection={createListCollection({ items: allFilteredModels })}
      value={[model]}
      onChange={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onValueChange={(change) => {
        const selectedValue = change.value[0];
        if (selectedValue) onChange(selectedValue);
      }}
      {...(open !== undefined ? { open } : {})}
      {...(onOpenChange ? { onOpenChange: (e) => onOpenChange(e.open) } : {})}
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
        background="bg"
        borderRadius="lg"
        padding={0}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Select.ValueText placeholder={selectValueText}>{() => selectValueText}</Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        <ModelSearchInput value={modelSearch} onChange={setModelSearch} />
        {filteredGroups.map((group) => (
          <ModelGroupItems key={group.provider} group={group} size={size} />
        ))}
        {showConfigureAction && <ConfigureModelsAction size={size} />}
      </Select.Content>
    </Select.Root>
  );
});
