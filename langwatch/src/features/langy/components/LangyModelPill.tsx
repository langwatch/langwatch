import {
  Box,
  Combobox,
  chakra,
  createListCollection,
  HStack,
  Portal,
  Text,
} from "@chakra-ui/react";
import {
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Gauge,
  Image,
  Layers3,
  LoaderCircle,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useModelSelectionOptions } from "~/components/ModelSelector";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";
import { LANGY_CHAT_FEATURE_KEY } from "~/server/modelProviders/codexRestrictions";
import {
  modelProviderIcons,
  ProviderIconGlyph,
} from "~/server/modelProviders/iconsMap";
import { getModelById } from "~/server/modelProviders/registry";
import {
  type LangyModelGroup,
  profileLangyModel,
} from "../logic/langyModelProfile";
import { splitLangyModels } from "../logic/langyModelSuggestions";
import { LangyComboboxSearch } from "./LangyComboboxSearch";

type ProviderKey = keyof typeof modelProviderIcons;

interface ModelItem {
  value: string;
  label: string;
  provider: string;
  /** What the filter + typeahead match against (provider + name). */
  searchText: string;
  isLangyDefault: boolean;
  profile: ReturnType<typeof profileLangyModel>;
}

const MODEL_GROUPS: Array<{
  id: LangyModelGroup;
  label: string;
  hint: string;
  icon: typeof Zap;
}> = [
  { id: "quick", label: "Quick", hint: "Fast, lighter work", icon: Zap },
  {
    id: "balanced",
    label: "Balanced",
    hint: "General purpose",
    icon: Gauge,
  },
  {
    id: "reasoning",
    label: "Deep reasoning",
    hint: "Complex work · may take longer",
    icon: Brain,
  },
  {
    id: "multimodal",
    label: "Multimodal",
    hint: "Image or audio output",
    icon: Image,
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Project-provided models",
    icon: Layers3,
  },
];

/**
 * The composer's per-send model picker, as a compact rail pill (reference
 * `.mpick`): a provider glyph + the model name + a chevron, sized to its label
 * and no bigger. It replaces the full shared `ModelSelector` trigger, which —
 * at the narrow composer width — rendered oversized and had to be wrestled into
 * shape with overflow overrides. Same options (`useModelSelectionOptions`,
 * scoped to the project's enabled providers) and the same provider glyphs; only
 * the trigger is bespoke.
 *
 * Built on Chakra's `Combobox` (Ark) so the dropdown is a real, accessible
 * listbox: type to filter, arrow keys to move, Enter to pick, Escape to close —
 * roving focus and aria wiring included (a hand-rolled Menu+input had none of
 * that). The search input inside the popover auto-focuses on open.
 */
/**
 * `triggerRef` exposes the pill's button so `/model` in the composer palette can
 * open THIS picker rather than the palette growing a second, divergent copy of
 * the model list.
 */
export function LangyModelPill({
  ref: triggerRef,
  model,
  options,
  onChange,
  langyDefaultModel,
  disabled = false,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  /** Current model, `provider/name`. */
  model: string;
  /** Candidate models (the VK allowlist, or all registry models). */
  options: string[];
  onChange: (model: string) => void;
  /** Model selected by the project's Langy routing configuration. */
  langyDefaultModel?: string | null;
  /** Lock the picker (e.g. while a turn is in flight) — greyed, can't open. */
  disabled?: boolean;
}) {
  // Langy is a licensed codex surface: declaring `langy.chat` re-admits
  // codex models the shared hook fail-closes everywhere else.
  const { selectOptions, modelOption } = useModelSelectionOptions(
    options,
    model,
    "chat",
    { featureKey: LANGY_CHAT_FEATURE_KEY },
  );
  const currentProvider = model.split("/")[0] ?? "";
  const hasCurrentProvider = currentProvider in modelProviderIcons;
  const modelsLoading = options.length === 0 && selectOptions.length === 0;
  const currentLabel =
    modelOption?.label ||
    model.split("/").slice(1).join("/") ||
    (modelsLoading ? "Models are still loading…" : "Choose model");

  const [query, setQuery] = useState("");

  const allItems = useMemo<ModelItem[]>(
    () =>
      selectOptions.map((option) => {
        const provider = option.value.split("/")[0] ?? "";
        return {
          value: option.value,
          label: option.label,
          provider,
          searchText: `${provider} ${option.label}`.toLowerCase(),
          isLangyDefault: option.value === langyDefaultModel,
          profile: profileLangyModel({
            modelId: option.value,
            metadata: getModelById(option.value),
            isCustom: option.isCustom,
          }),
        };
      }),
    [selectOptions, langyDefaultModel],
  );

  // Build the collection reactively from the CURRENT items (the model list
  // arrives async from a tRPC query, so a one-shot `useListCollection` snapshot
  // would freeze it empty). Filtering is a plain substring match on the
  // provider+name text, rebuilt per keystroke — the list is modest.
  const collection = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = q
      ? allItems.filter((item) => item.searchText.includes(q))
      : allItems;
    return createListCollection({
      items,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.searchText,
    });
  }, [allItems, query]);

  // The catalogue is the right list and the wrong front door — see
  // logic/langyModelSuggestions.ts. A short derived shortlist leads; everything
  // else waits behind "More models".
  const searching = query.trim().length > 0;
  const { suggested, more } = useMemo(
    () =>
      splitLangyModels({
        items: collection.items,
        langyDefaultModel,
        selectedModel: model,
        searching,
      }),
    [collection.items, langyDefaultModel, model, searching],
  );

  const groupedItems = useMemo(
    () =>
      MODEL_GROUPS.map((group) => ({
        ...group,
        items: more.filter((item) => item.profile.group === group.id),
      })).filter((group) => group.items.length > 0),
    [more],
  );

  // Collapsed by default — the point of the shortlist is that the catalogue is
  // out of the way. A search forces it open, because a search that hides its own
  // matches is a search that lies; and with no shortlist there is nothing to
  // disclose, so the catalogue simply IS the list.
  const [showMore, setShowMore] = useState(false);
  const moreOpen = showMore || searching || suggested.length === 0;

  return (
    <Combobox.Root
      collection={collection}
      disabled={disabled}
      value={model ? [model] : []}
      openOnClick
      selectionBehavior="clear"
      onValueChange={(details) => {
        const next = details.value?.[0];
        if (next) onChange(next);
      }}
      onInputValueChange={(details) => setQuery(details.inputValue)}
      onOpenChange={(details) => {
        if (details.open) setQuery("");
      }}
      positioning={{ placement: "top-start", gutter: 6 }}
      width="auto"
    >
      {/*
       * The element Ark anchors the listbox to. Ark positions against the
       * CONTROL, not the trigger — with no Control rendered there is no anchor,
       * and the listbox lands in the top-left corner of the viewport. (Feeding
       * it a rect from the trigger ref via `getAnchorRect` doesn't fix it: on
       * the first open the ref hasn't landed, so the rect is null, and a null
       * anchor collapses to the origin just the same.)
       *
       * `inline-flex` so it hugs the pill instead of stretching the composer
       * rail. It must generate a layout box — never `display: contents`, which
       * has no rect to measure.
       */}
      <Combobox.Control display="inline-flex" width="auto" minWidth={0}>
        <Combobox.Trigger asChild>
          {/*
           * COLLAPSED BY DEFAULT: just the provider glyph, so the rail stays a row
           * of quiet icons and the model name doesn't eat a third of the composer.
           * It expands on hover — and on `:focus-visible`, so a keyboard user sees
           * exactly what a mouse user sees before committing — and stays expanded
           * while the listbox is open (`[data-state="open"]`).
           *
           * Purely a CSS width transition on a wrapper, so nothing re-renders and
           * the button never loses focus mid-expand. The full model name is always
           * in `aria-label`, so the collapsed state is never a loss for assistive
           * tech — only for pixels.
           */}
          <chakra.button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            data-testid="langy-model-picker"
            data-model={model}
            data-loading={modelsLoading ? "true" : undefined}
            aria-label={`Model: ${currentLabel}`}
            display="inline-flex"
            alignItems="center"
            gap={0}
            height="28px"
            maxWidth="200px"
            paddingLeft={1.5}
            paddingRight={1.5}
            borderRadius="full"
            borderWidth="1px"
            borderStyle="solid"
            borderColor="border.emphasized"
            background="bg.surface"
            color="fg.muted"
            flexShrink={1}
            minWidth={0}
            opacity={disabled ? 0.5 : 1}
            cursor={disabled ? "not-allowed" : "pointer"}
            transition="border-color 150ms ease, color 150ms ease, opacity 150ms ease"
            _hover={
              disabled
                ? undefined
                : { borderColor: "orange.emphasized", color: "fg" }
            }
            _focusVisible={{
              outline: "none",
              borderColor: "orange.emphasized",
              color: "fg",
            }}
            _disabled={{ pointerEvents: "none" }}
            css={{
              "& .model-reveal": {
                display: "flex",
                alignItems: "center",
                gap: "4px",
                maxWidth: 0,
                opacity: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                transition:
                  "max-width 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 140ms ease, margin-left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
              },
              "&:hover .model-reveal, &:focus-visible .model-reveal, &[data-state='open'] .model-reveal":
                { maxWidth: "160px", opacity: 1, marginLeft: "6px" },
              "&[data-loading='true'] .model-reveal": {
                maxWidth: "180px",
                opacity: 1,
                marginLeft: "6px",
              },
              "@media (prefers-reduced-motion: reduce)": {
                "& .model-reveal": { transition: "none" },
              },
            }}
          >
            {hasCurrentProvider ? (
              <Box flexShrink={0} display="grid" placeItems="center">
                <ProviderIconGlyph
                  provider={currentProvider as ProviderKey}
                  size="15px"
                />
              </Box>
            ) : (
              <Box
                flexShrink={0}
                display="grid"
                placeItems="center"
                color="fg.subtle"
              >
                {modelsLoading ? (
                  <LoaderCircle size={15} />
                ) : (
                  <Layers3 size={15} />
                )}
              </Box>
            )}
            <chakra.span className="model-reveal">
              <Text textStyle="xs" fontWeight="500" truncate>
                {currentLabel}
              </Text>
              <Box
                color="fg.subtle"
                flexShrink={0}
                display="grid"
                placeItems="center"
              >
                <ChevronDown size={12} />
              </Box>
            </chakra.span>
          </chakra.button>
        </Combobox.Trigger>
      </Combobox.Control>
      <Portal>
        <Combobox.Positioner>
          <Combobox.Content
            minWidth="240px"
            maxHeight="340px"
            overflowY="auto"
            padding={0}
            borderRadius="12px"
            background="bg.panel/96"
            borderWidth="1px"
            borderColor="border.muted"
            boxShadow="lg"
          >
            {modelsLoading ? (
              <HStack paddingX={3} paddingY={3} gap={2} color="fg.muted">
                <LoaderCircle size={14} />
                <Text textStyle="xs">
                  Models are still loading. Try again in a moment.
                </Text>
              </HStack>
            ) : (
              <>
                <LangyComboboxSearch placeholder="Search models" />
                <Combobox.Empty
                  paddingX={2}
                  paddingY={2}
                  color="fg.muted"
                  textStyle="xs"
                >
                  No models match your search.
                </Combobox.Empty>
              </>
            )}
            <Box padding={1}>
              {suggested.length > 0 ? (
                <Combobox.ItemGroup>
                  <Combobox.ItemGroupLabel
                    display="flex"
                    alignItems="center"
                    gap={1.5}
                    paddingX={2}
                    paddingTop={2}
                    paddingBottom={1}
                    color="fg.subtle"
                  >
                    <Sparkles size={11} />
                    <Text
                      textStyle="2xs"
                      fontWeight="600"
                      textTransform="uppercase"
                      letterSpacing="0.07em"
                    >
                      Suggested
                    </Text>
                  </Combobox.ItemGroupLabel>
                  {suggested.map((item) => (
                    <ModelRow key={item.value} item={item} />
                  ))}
                </Combobox.ItemGroup>
              ) : null}

              {/* The disclosure only exists when there is a shortlist to hide
                  the rest behind. It is a real button, not a header that
                  happens to be clickable, so it is reachable by keyboard from
                  inside the listbox. */}
              {suggested.length > 0 && groupedItems.length > 0 && !searching ? (
                <chakra.button
                  type="button"
                  onClick={() => setShowMore((open) => !open)}
                  aria-expanded={moreOpen}
                  display="flex"
                  alignItems="center"
                  gap={1.5}
                  width="full"
                  marginTop={1}
                  paddingX={2}
                  paddingY={1.5}
                  borderRadius="md"
                  borderWidth={0}
                  background="transparent"
                  color="fg.muted"
                  cursor="pointer"
                  _hover={{ background: "bg.subtle", color: "fg" }}
                >
                  <Box
                    display="grid"
                    placeItems="center"
                    transition="transform 160ms ease"
                    transform={moreOpen ? "rotate(180deg)" : undefined}
                  >
                    <ChevronDown size={12} />
                  </Box>
                  <Text textStyle="2xs" fontWeight="500">
                    {moreOpen ? "Fewer models" : "More models"}
                  </Text>
                  <Text textStyle="2xs" color="fg.subtle">
                    {more.length}
                  </Text>
                </chakra.button>
              ) : null}

              {moreOpen
                ? groupedItems.map(
                    ({ id, label, hint, icon: GroupIcon, items }) => (
                      <Combobox.ItemGroup key={id}>
                        <Combobox.ItemGroupLabel
                          display="flex"
                          alignItems="center"
                          gap={1.5}
                          paddingX={2}
                          paddingTop={2}
                          paddingBottom={1}
                          color="fg.subtle"
                        >
                          <GroupIcon size={11} />
                          <Text
                            textStyle="2xs"
                            fontWeight="600"
                            textTransform="uppercase"
                            letterSpacing="0.07em"
                          >
                            {label}
                          </Text>
                          <Text textStyle="2xs" fontWeight="400" opacity={0.72}>
                            · {hint}
                          </Text>
                        </Combobox.ItemGroupLabel>
                        {items.map((item) => (
                          <ModelRow key={item.value} item={item} />
                        ))}
                      </Combobox.ItemGroup>
                    ),
                  )
                : null}
            </Box>
            {/* Same escape hatch the shared ModelSelector pins to its foot:
                the list you are looking at is configurable, and this is the
                road to it. Sticky so it stays visible over a scrolled list. */}
            <Box
              position="sticky"
              bottom={0}
              background="bg.panel"
              borderTopWidth="1px"
              borderColor="border.muted"
            >
              <Link
                href="/settings/model-providers"
                isExternal
                display="flex"
                alignItems="center"
                gap={1.5}
                paddingX={3}
                paddingY={2}
                color="fg.muted"
                _hover={{
                  background: "bg.subtle",
                  color: "fg",
                  textDecoration: "none",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <SlidersHorizontal size={12} />
                <Text textStyle="2xs" fontWeight="500">
                  Configure available models
                </Text>
              </Link>
            </Box>
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}

function ModelRow({ item }: { item: ModelItem }) {
  const hasProviderIcon = item.provider in modelProviderIcons;
  return (
    <Combobox.Item
      item={item}
      borderRadius="md"
      paddingX={2}
      paddingY={1.25}
      _hover={{ background: "bg.subtle" }}
      _highlighted={{ background: "bg.subtle" }}
    >
      <HStack gap={2} width="full">
        <Box
          flexShrink={0}
          display="grid"
          placeItems="center"
          color="fg.subtle"
        >
          {hasProviderIcon ? (
            <ProviderIconGlyph
              provider={item.provider as ProviderKey}
              size="15px"
            />
          ) : (
            <Layers3 size={15} />
          )}
        </Box>
        {/* The NAME is the thing being chosen, so it gets a floor. With
            `minWidth: 0` and every sibling `flexShrink={0}`, a row carrying
            four trait icons plus the "Langy default" badge squeezed the label
            to "g…" — the one row a user most needs to read was the one row
            they could not. */}
        <Combobox.ItemText
          css={{ flex: 1, minWidth: "8ch" }}
          fontSize="13px"
          truncate
        >
          {item.label}
        </Combobox.ItemText>
        {/* Traits yield first: they are a glanceable extra, and losing one to
            a narrow row costs less than losing the name. */}
        <HStack gap={1} color="fg.subtle" flexShrink={1} overflow="hidden">
          {item.profile.isQuick ? <ModelTrait label="Fast" icon={Zap} /> : null}
          {item.profile.isLongRunning ? (
            <ModelTrait label="Long-running" icon={Clock3} />
          ) : null}
          {item.profile.hasReasoning ? (
            <ModelTrait label="Reasoning" icon={Brain} />
          ) : null}
          {item.profile.isMultimodal ? (
            <ModelTrait label="Multimodal" icon={Image} />
          ) : null}
        </HStack>
        {item.isLangyDefault ? (
          <Text
            textStyle="2xs"
            color="orange.fg"
            whiteSpace="nowrap"
            flexShrink={0}
          >
            Default
          </Text>
        ) : null}
        <Combobox.ItemIndicator>
          <Box color="orange.fg">
            <Check size={12} />
          </Box>
        </Combobox.ItemIndicator>
      </HStack>
    </Combobox.Item>
  );
}

function ModelTrait({
  label,
  icon: Icon,
}: {
  label: string;
  icon: typeof Zap;
}) {
  return (
    <Tooltip content={label} positioning={{ placement: "top" }}>
      <Box
        aria-label={label}
        display="grid"
        placeItems="center"
        width="18px"
        height="18px"
        borderRadius="5px"
        background="bg.muted"
      >
        <Icon size={10} />
      </Box>
    </Tooltip>
  );
}
