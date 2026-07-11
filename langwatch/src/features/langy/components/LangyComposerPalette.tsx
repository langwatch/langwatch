import {
  Box,
  Combobox,
  createListCollection,
  HStack,
  Portal,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Cpu, Sparkles, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { LANGY_SKILLS } from "~/shared/langy/langySkills";
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

export type PaletteMode = "skill" | "context";

/** One row of the palette. A skill, a context chip, or the model command. */
interface PaletteItem {
  value: string;
  label: string;
  detail: string;
  group: "Skills" | "Context" | "Commands";
  searchText: string;
}

/** `/model` is a real command because the model picker is real. */
const MODEL_COMMAND = "command:model";

function buildItems({
  mode,
  chips,
}: {
  mode: PaletteMode;
  chips: LangyContextChip[];
}): PaletteItem[] {
  if (mode === "context") {
    return chips.map((chip) => ({
      value: `chip:${chip.id}`,
      label: chip.label,
      detail: chip.kind,
      group: "Context" as const,
      searchText: `${chip.label} ${chip.kind}`.toLowerCase(),
    }));
  }

  return [
    {
      value: MODEL_COMMAND,
      label: "Change model",
      detail: "/model",
      group: "Commands" as const,
      searchText: "model change switch /model",
    },
    // Every entry here is derived from feature-map.json's CLI commands or the
    // agent's own skills directory. Nothing in this list is asserted by hand.
    ...LANGY_SKILLS.map((skill) => ({
      value: `skill:${skill.id}`,
      label: skill.label,
      detail: skill.summary,
      group: "Skills" as const,
      searchText: skill.searchText,
    })),
  ];
}

export function LangyComposerPalette({
  mode,
  query,
  chips,
  onQueryChange,
  onPickSkill,
  onPickChip,
  onPickModel,
  onClose,
}: {
  mode: PaletteMode;
  query: string;
  /** Resource chips available to reference with `#`. */
  chips: LangyContextChip[];
  onQueryChange: (value: string) => void;
  onPickSkill: (id: string) => void;
  onPickChip: (id: string) => void;
  onPickModel: () => void;
  onClose: () => void;
}) {
  const [items] = useState(() => buildItems({ mode, chips }));

  const collection = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) => item.searchText.includes(q))
      : items;
    return createListCollection({
      items: filtered,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    });
  }, [items, query]);

  const pick = (value: string) => {
    if (value === MODEL_COMMAND) {
      onPickModel();
      return;
    }
    if (value.startsWith("skill:")) {
      onPickSkill(value.slice("skill:".length));
      return;
    }
    if (value.startsWith("chip:")) {
      onPickChip(value.slice("chip:".length));
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
            {mode === "skill" ? (
              <Sparkles size={13} />
            ) : (
              <Waypoints size={13} />
            )}
          </Box>
          <Combobox.Input
            autoFocus
            placeholder={
              mode === "skill"
                ? "Use a skill…  (Esc to cancel)"
                : "Reference context…  (Esc to cancel)"
            }
            flex={1}
            minWidth={0}
            border="none"
            background="transparent"
            fontSize="12.5px"
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
                {mode === "skill"
                  ? "No skill matches that."
                  : "Nothing on this page matches that."}
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
                    ) : item.group === "Skills" ? (
                      <Sparkles size={13} />
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
          </Combobox.Content>
        </Combobox.Positioner>
      </Portal>
    </Combobox.Root>
  );
}
