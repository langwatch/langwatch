import {
  Box,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Cpu, Plus, Sparkles, Waypoints } from "lucide-react";
import { useEffect, useMemo } from "react";
import { LANGY_SKILLS, type LangySkill } from "~/shared/langy/langySkills";
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
 *
 * ── WHY IT SAYS WHICH MODE IT IS IN ────────────────────────────────────────
 * Both keys open the same-looking bar, so the bar has to say which one you
 * pressed. It wears a titled badge ("Context" / "Skills") and its rows are
 * grouped under headings; without that the two modes are one ambiguous box and
 * the only way to tell them apart is to read the results and guess.
 */

export type PaletteMode = "context" | "skills";

/** Everything the palette needs to introduce itself. */
const MODE_CHROME: Record<
  PaletteMode,
  { title: string; sigil: string; placeholder: string; empty: string }
> = {
  context: {
    title: "Context",
    sigil: "#",
    placeholder: "Reference something on this page…  (Esc to cancel)",
    empty: "Nothing on this page matches that.",
  },
  skills: {
    title: "Skills",
    sigil: "/",
    placeholder: "Pick a skill for Langy to use…  (Esc to cancel)",
    empty: "No skill matches that.",
  },
};

/** Row groups, in the order they are shown AND navigated. */
type PaletteGroup =
  | "Context"
  | "On this page"
  | "Commands"
  | "Skills"
  | "Recipes"
  | "Platform";

const GROUP_ORDER: Record<PaletteMode, PaletteGroup[]> = {
  context: ["Context", "On this page", "Commands"],
  skills: ["Skills", "Recipes", "Platform", "Commands"],
};

/** One row of the palette. A skill, a chip, a page target, or a command. */
interface PaletteItem {
  value: string;
  label: string;
  detail: string;
  group: PaletteGroup;
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

/** Where a skill lands in the list, by where its ability comes from. */
function groupForSkill(skill: LangySkill): PaletteGroup {
  if (skill.source === "recipe") return "Recipes";
  if (skill.source === "client-command") return "Commands";
  if (skill.source === "cli") return "Platform";
  return "Skills";
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
  if (mode === "skills") {
    return LANGY_SKILLS.map((skill) => ({
      value: `skill:${skill.id}`,
      label: skill.label,
      detail: skill.summary,
      group: groupForSkill(skill),
      searchText: skill.searchText,
    }));
  }
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
  onPickSkill,
  onKindIntent,
  onClose,
}: {
  mode: PaletteMode;
  query: string;
  /** Resource chips available to reference with `#`. */
  chips: LangyContextChip[];
  onQueryChange: (value: string) => void;
  onPickChip: (id: string) => void;
  /** A skill picked from `/` — the composer drops its question into the draft. */
  onPickSkill?: (skill: LangySkill) => void;
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
  const setSpotlight = useLangyContextTargetStore((s) => s.setSpotlight);
  const chrome = MODE_CHROME[mode];

  // A row that names something on the page lights that thing up while the
  // pointer is on it — the palette says which card it means instead of asking
  // the user to match a label against nine of them. Cleared on the way out, so
  // a dismissed palette never leaves the page glowing.
  useEffect(() => () => setSpotlight(null), [setSpotlight]);
  const spotlightFor = (value: string) =>
    value.startsWith("chip:")
      ? value.slice("chip:".length)
      : value.startsWith("target:")
        ? value.slice("target:".length)
        : null;

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
        new Set(Object.values(registeredTargets).map((target) => target.kind)),
      ).map(intentItem);
    }
    // Sorted into group order BEFORE the collection is built, so the order the
    // eye reads and the order ↑/↓ walks are the same order. Grouped rendering
    // over an unsorted collection is how a palette ends up jumping between
    // headings as you arrow through it.
    const order = GROUP_ORDER[mode];
    const sorted = [...rows].sort(
      (a, b) => order.indexOf(a.group) - order.indexOf(b.group),
    );
    return createListCollection({
      items: sorted,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    });
  }, [items, query, mode, registeredTargets]);

  /** The groups actually present, in display order. */
  const groups = useMemo(() => {
    const present = new Set(collection.items.map((item) => item.group));
    return GROUP_ORDER[mode].filter((group) => present.has(group));
  }, [collection, mode]);

  const pick = (value: string) => {
    if (value.startsWith("chip:")) {
      onPickChip(value.slice("chip:".length));
      return;
    }
    if (value.startsWith("skill:")) {
      const id = value.slice("skill:".length);
      const skill = LANGY_SKILLS.find((candidate) => candidate.id === id);
      if (skill) onPickSkill?.(skill);
      onClose();
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
          {/* The title badge. It carries the key you pressed as well as the
              name of the mode, so "which one is this, and what opened it" is
              answered without leaving the bar. */}
          <HStack
            gap={1}
            flexShrink={0}
            paddingLeft={1.5}
            paddingRight={2}
            paddingY={0.5}
            borderRadius="full"
            background="orange.subtle"
            color="orange.fg"
          >
            <Box display="grid" placeItems="center">
              {mode === "skills" ? (
                <Sparkles size={11} />
              ) : (
                <Waypoints size={11} />
              )}
            </Box>
            <Text
              textStyle="2xs"
              fontWeight="semibold"
              data-testid="langy-palette-title"
            >
              {chrome.title}
            </Text>
            <Text textStyle="2xs" opacity={0.7} fontFamily="mono">
              {chrome.sigil}
            </Text>
          </HStack>
          <Combobox.Input
            autoFocus
            placeholder={chrome.placeholder}
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
                {chrome.empty}
              </Text>
            </Combobox.Empty>

            {groups.map((group) => (
              <Combobox.ItemGroup key={group}>
                <Combobox.ItemGroupLabel
                  paddingX={2}
                  paddingTop={2}
                  paddingBottom={1}
                >
                  <Text
                    textStyle="2xs"
                    fontWeight="semibold"
                    color="fg.subtle"
                    letterSpacing="0.04em"
                    textTransform="uppercase"
                  >
                    {group}
                  </Text>
                </Combobox.ItemGroupLabel>
                {collection.items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <Combobox.Item
                      item={item}
                      key={item.value}
                      borderRadius="md"
                      paddingX={2}
                      paddingY={1.5}
                      _hover={{ background: "bg.subtle" }}
                      _highlighted={{ background: "bg.subtle" }}
                      onMouseEnter={() =>
                        setSpotlight(spotlightFor(item.value))
                      }
                      onMouseLeave={() => setSpotlight(null)}
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
                          ) : item.group === "Context" ? (
                            <Waypoints size={13} />
                          ) : (
                            <Sparkles size={13} />
                          )}
                        </Box>
                        <VStack align="start" gap={0} flex={1} minWidth={0}>
                          <Combobox.ItemText css={{ width: "100%" }}>
                            <Text textStyle="sm" color="fg" truncate>
                              {item.label}
                            </Text>
                          </Combobox.ItemText>
                          {/* The detail line is the honest one: for a CLI skill
                              it is the verbs the feature map actually declares. */}
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
              </Combobox.ItemGroup>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
