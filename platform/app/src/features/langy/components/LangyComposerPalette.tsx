import {
  Box,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Cpu, Plus, Waypoints } from "lucide-react";
import { useMemo } from "react";
import {
  allKindIntents,
  kindIntentForQuery,
  type LangyKindIntent,
} from "../logic/langyContextKindIntent";
import {
  absorbContextTarget,
  type LangyContextTarget,
  type LangyRevealableKind,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import type { LangyContextChip } from "../stores/langyStore";

/**
 * The composer's command palette — `/` for skills, `#` for context.
 *
 * ── WHY THE COMPOSER BECOMES A COMMAND BAR ─────────────────────────────────
 * A `/` menu inside a textarea is the classic trap: Ark's Combobox owns an
 * `<input>`, a textarea is not one, and driving the machine from the outside
 * means re-implementing highlight navigation, `aria-activedescendant` and roving
 * focus by hand — the exact hand-rolled popup we are trying not to build.
 *
 * So the `/` does not open a popup NEXT TO the text. It turns the top of the
 * composer INTO a real combobox: a genuine `Combobox.Input` with a genuine
 * listbox anchored to it. Focus moves there, Ark provides every keyboard
 * behaviour (type to filter, ↑/↓, Enter, Escape) for free, and the `/` token is
 * never inserted into the message in the first place — so there is nothing to
 * strip afterwards, and no way for a half-typed command to survive into a
 * prompt.
 *
 * Escape returns focus to the textarea with the message exactly as it was.
 */

export type PaletteMode = "context";

/** One row of the palette. A skill, a chip, a page target, or a command. */
interface PaletteItem {
  value: string;
  label: string;
  detail: string;
  group: "Context" | "On this page" | "Commands";
  searchText: string;
}

/** The palette row a kind intent becomes ("Show traces on this page"). */
function intentItem(intent: LangyKindIntent): PaletteItem {
  return {
    value: `intent:${intent.action}:${intent.kind}`,
    label: intent.label,
    detail: intent.detail,
    group: "Commands",
    searchText: "", // Appended for the query that produced it; never filtered.
  };
}

function buildItems({
  mode,
  chips,
  pageTargets,
}: {
  mode: PaletteMode;
  chips: LangyContextChip[];
  pageTargets: LangyContextTarget[];
}): PaletteItem[] {
  return [
    ...chips.map((chip) => ({
      value: `chip:${chip.id}`,
      label: chip.label,
      detail: chip.kind,
      group: "Context" as const,
      searchText: `${chip.label} ${chip.kind}`.toLowerCase(),
    })),
    ...pageTargets.map((target) => ({
      value: `target:${target.id}`,
      label: target.label,
      detail: target.kind,
      group: "On this page" as const,
      searchText: `${target.label} ${target.kind}`.toLowerCase(),
    })),
  ];
}

export function LangyComposerPalette({
  mode,
  query,
  chips,
  onQueryChange,
  onPickChip,
  onKindIntent,
  onClose,
}: {
  mode: PaletteMode;
  query: string;
  /** Resource chips available to reference with `#`. */
  chips: LangyContextChip[];
  onQueryChange: (value: string) => void;
  onPickChip: (id: string) => void;
  /** `#trace`-style kind intents: reveal targets here, or browse the surface. */
  onKindIntent?: (intent: {
    kind: LangyRevealableKind;
    action: "reveal" | "browse";
  }) => void;
  onClose: () => void;
}) {
  // The registry of things mounted on the page (only populated while the panel
  // is open). Subscribed here — not in the composer — so its churn only ever
  // re-renders the palette, which exists for seconds at a time.
  const registeredTargets = useLangyContextTargetStore((s) => s.targets);
  const activeChipIds = useLangyContextTargetStore((s) => s.activeChipIds);

  const items = useMemo(() => {
    const pageTargets = Object.values(registeredTargets).filter(
      (target) => !activeChipIds.has(target.id),
    );
    return buildItems({ mode, chips, pageTargets });
  }, [mode, chips, registeredTargets, activeChipIds]);

  const collection = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) => item.searchText.includes(q))
      : items;
    // `#trace` on a page (or query) that names a KIND rather than a resource
    // gets an intent row — appended, never filtered out by its own query.
    const intent =
      mode === "context"
        ? kindIntentForQuery({
            query,
            presentKinds: new Set(
              Object.values(registeredTargets).map((target) => target.kind),
            ),
          })
        : null;
    let rows = intent ? [...filtered, intentItem(intent)] : filtered;
    // `#` must never dead-end: a page with nothing pickable (and a query that
    // names no kind) gets the doors instead of an empty box — one browse /
    // reveal intent per kind.
    if (mode === "context" && rows.length === 0) {
      rows = allKindIntents(
        new Set(
          Object.values(registeredTargets).map((target) => target.kind),
        ),
      ).map(intentItem);
    }
    return createListCollection({
      items: rows,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    });
  }, [items, query, mode, registeredTargets]);

  const pick = (value: string) => {
    if (value.startsWith("chip:")) {
      onPickChip(value.slice("chip:".length));
      return;
    }
    if (value.startsWith("target:")) {
      const target =
        useLangyContextTargetStore.getState().targets[
          value.slice("target:".length)
        ];
      if (target) absorbContextTarget(target);
      onClose();
      return;
    }
    if (value.startsWith("intent:")) {
      const [, action, kind] = value.split(":");
      onKindIntent?.({
        kind: kind as LangyRevealableKind,
        action: action as "reveal" | "browse",
      });
      onClose();
    }
  };

  return (
    <Combobox.Root
      collection={collection}
      // Always open: the palette only exists while it is open. Its lifetime IS
      // the interaction, so there is no closed state to model.
      open
      openOnClick
      inputValue={query}
      selectionBehavior="clear"
      onInputValueChange={(details) => onQueryChange(details.inputValue)}
      onValueChange={(details) => {
        const value = details.value?.[0];
        if (value) pick(value);
      }}
      onOpenChange={(details) => {
        // Ark closes on Escape and on outside-click. Either way the user is
        // done — hand focus back to the message.
        if (!details.open) onClose();
      }}
      positioning={{ placement: "top-start", gutter: 8, sameWidth: true }}
    >
      {/* The Control is the anchor AND the field. Rendered inside the composer
          card, so the listbox lands exactly above the composer with no
          getAnchorRect guesswork. */}
      <Combobox.Control width="full">
        <HStack
          gap={1.5}
          paddingX={3}
          paddingTop={2.5}
          paddingBottom={1}
          align="center"
        >
          <Box color="orange.fg" flexShrink={0} display="grid">
            <Waypoints size={13} />
          </Box>
          <Combobox.Input
            autoFocus
            placeholder="Reference context…  (Esc to cancel)"
            flex={1}
            minWidth={0}
            border="none"
            background="transparent"
            fontSize="sm"
            color="fg"
            _focusVisible={{ outline: "none" }}
            onKeyDown={(event) => {
              // Backspacing past the empty query dismisses the palette — the
              // same gesture that deletes the `/` you just typed.
              if (event.key === "Backspace" && query.length === 0) {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </HStack>
      </Combobox.Control>

      <Portal>
        <Combobox.Positioner>
          <Combobox.Content
            maxHeight="280px"
            overflowY="auto"
            padding={1}
            background="bg.panel/80"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="langyCard"
            boxShadow="lg"
            css={{
              backdropFilter: "blur(18px) saturate(0.6)",
              WebkitBackdropFilter: "blur(18px) saturate(0.6)",
            }}
          >
            <Combobox.Empty paddingX={2} paddingY={3}>
              <Text textStyle="xs" color="fg.muted">
                Nothing on this page matches that.
              </Text>
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
                <HStack gap={2.5} width="full" align="start">
                  <Box
                    color="fg.subtle"
                    flexShrink={0}
                    display="grid"
                    placeItems="center"
                    paddingTop="1px"
                  >
                    {item.group === "Commands" ? (
                      <Cpu size={13} />
                    ) : item.group === "On this page" ? (
                      <Plus size={13} />
                    ) : (
                      <Waypoints size={13} />
                    )}
                  </Box>
                  <VStack align="start" gap={0} flex={1} minWidth={0}>
                    <Combobox.ItemText css={{ width: "100%" }}>
                      <Text textStyle="sm" color="fg" truncate>
                        {item.label}
                      </Text>
                    </Combobox.ItemText>
                    {/* The detail line is the honest one: for a CLI skill it is
                        the verbs the feature map actually declares. */}
                    <Text
                      textStyle="2xs"
                      color="fg.subtle"
                      truncate
                      maxWidth="100%"
                    >
                      {item.detail}
                    </Text>
                  </VStack>
                </HStack>
              </Combobox.Item>
            ))}

            {/* The palette's own help line — the keyboard route teaching the
                pointer route. One quiet sentence inside an ephemeral surface
                the user summoned; it costs nothing when the palette is closed
                (the palette doesn't exist then). */}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
