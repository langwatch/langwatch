import {
  Box,
  chakra,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
} from "@chakra-ui/react";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useModelSelectionOptions } from "~/components/ModelSelector";
import {
  type modelProviderIcons,
  ProviderIconGlyph,
} from "~/server/modelProviders/iconsMap";

type ProviderKey = keyof typeof modelProviderIcons;

interface ModelItem {
  value: string;
  label: string;
  provider: string;
  /** What the filter + typeahead match against (provider + name). */
  searchText: string;
}

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
}: {
  ref?: React.Ref<HTMLButtonElement>;
  /** Current model, `provider/name`. */
  model: string;
  /** Candidate models (the VK allowlist, or all registry models). */
  options: string[];
  onChange: (model: string) => void;
}) {
  const { selectOptions, modelOption } = useModelSelectionOptions(
    options,
    model,
    "chat",
  );
  const currentProvider = model.split("/")[0] ?? "";
  const currentLabel =
    modelOption?.label || model.split("/").slice(1).join("/") || "Choose model";

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
        };
      }),
    [selectOptions],
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

  return (
    <Combobox.Root
      collection={collection}
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
            data-testid="langy-model-picker"
            data-model={model}
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
            transition="border-color 150ms ease, color 150ms ease"
            _hover={{ borderColor: "orange.emphasized", color: "fg" }}
            _focusVisible={{
              outline: "none",
              borderColor: "orange.emphasized",
              color: "fg",
            }}
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
              "@media (prefers-reduced-motion: reduce)": {
                "& .model-reveal": { transition: "none" },
              },
            }}
          >
            {currentProvider ? (
              <Box flexShrink={0} display="grid" placeItems="center">
                <ProviderIconGlyph
                  provider={currentProvider as ProviderKey}
                  size="15px"
                />
              </Box>
            ) : null}
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
            padding={1}
          >
            <Box
              position="sticky"
              top={0}
              zIndex={1}
              background="bg.panel"
              paddingBottom={1}
            >
              <Combobox.Input
                autoFocus
                placeholder="Search models"
                width="full"
                height="32px"
                paddingX={2.5}
                borderRadius="md"
                borderWidth="1px"
                borderStyle="solid"
                borderColor="border"
                background="bg.subtle"
                fontSize="13px"
                color="fg"
                _focusVisible={{
                  outline: "none",
                  borderColor: "orange.emphasized",
                }}
              />
            </Box>
            <Combobox.Empty
              paddingX={2}
              paddingY={2}
              color="fg.muted"
              textStyle="xs"
            >
              No models match your search.
            </Combobox.Empty>
            {collection.items.map((item) => (
              <Combobox.Item
                item={item}
                key={item.value}
                borderRadius="md"
                paddingX={2}
                paddingY={1.5}
                _hover={{ background: "bg.subtle" }}
                _highlighted={{ background: "bg.subtle" }}
              >
                <HStack gap={2} width="full">
                  <Box flexShrink={0} display="grid" placeItems="center">
                    <ProviderIconGlyph
                      provider={item.provider as ProviderKey}
                      size="15px"
                    />
                  </Box>
                  <Combobox.ItemText
                    css={{ flex: 1, minWidth: 0 }}
                    fontSize="13px"
                    truncate
                  >
                    {item.label}
                  </Combobox.ItemText>
                  <Combobox.ItemIndicator>
                    <Box color="orange.fg">
                      <Check size={12} />
                    </Box>
                  </Combobox.ItemIndicator>
                </HStack>
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
