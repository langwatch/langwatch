/**
 * The choices card, the one sanctioned UI for the decision that belongs to the user
 * (ADR-060 §6). A question is an ask, not a view Langy composed, so it wears no
 * derived frame. A bare card draws its question as reply prose above the options.
 */
import { Markdown } from "@langwatch/browser-host/markdown";
import { Box, Button, chakra, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type {
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyDerivedChoicesCard,
} from "@langwatch/langy-contract";
import { Check, CircleSlash } from "lucide-react";
import { useState } from "react";

import type { ChoicesRefRow } from "../../../features/langy/behavior/derived-cards/use-choices-ref-rows.ts";

/**
 * An option's label is the answer, not a name for the thing it points at: a
 * live reference supplies the detail line, the label stays the row.
 */
function optionRowText({
  option,
  refRow,
}: {
  option: LangyDerivedChoicesCard["options"][number];
  refRow: ChoicesRefRow;
}): { primary: string; secondary?: string } {
  if (refRow.state === "dead") {
    return { primary: option.label, secondary: "No longer exists" };
  }
  const detail =
    refRow.state === "live"
      ? [refRow.primary, refRow.secondary]
          .filter((part): part is string => !!part && part !== option.label)
          .join(" · ")
      : "";
  const secondary = detail !== "" ? detail : option.description;
  return { primary: option.label, ...(secondary !== undefined ? { secondary } : {}) };
}

/** The tint an option's glyph carries: picked, struck out, or plain. */
function choiceMarkColor({ marked, dead }: { marked: boolean; dead: boolean }) {
  if (marked) return "purple.fg";
  return dead ? "fg.subtle" : "fg.muted";
}

/** The tint a quiet link carries: picked, selectable, or settled. */
function quietLinkColor({ marked, selectable }: { marked: boolean; selectable: boolean }) {
  if (marked) return "purple.fg";
  return selectable ? "fg.muted" : "fg.subtle";
}

/** A quiet option is the way out, not the way forward: a link that answers like a row. */
function QuietChoiceOption({
  option,
  marked,
  selectable,
  onToggle,
}: {
  option: LangyDerivedChoicesCard["options"][number];
  marked: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  return (
    <chakra.button
      type="button"
      data-testid="langy-choice-option"
      data-option-id={option.id}
      data-quiet="true"
      disabled={!selectable}
      onClick={onToggle}
      alignSelf="flex-start"
      paddingX={2}
      paddingTop={0.5}
      textAlign="left"
      textStyle="xs"
      textDecoration="underline"
      textUnderlineOffset="2px"
      background="transparent"
      color={quietLinkColor({ marked, selectable })}
      cursor={selectable ? "pointer" : "default"}
      aria-disabled={!selectable}
      aria-pressed={marked}
      _hover={selectable ? { color: "fg" } : undefined}
      transition="color 120ms ease"
    >
      {option.label}
    </chakra.button>
  );
}

/** The glyph beside an option: struck out, ticked, or an empty box waiting. */
function ChoiceMark({ dead, marked, multi }: { dead: boolean; marked: boolean; multi: boolean }) {
  if (dead) return <CircleSlash size={13} />;
  if (marked) return <Check size={13} />;
  return (
    <Box
      width="11px"
      height="11px"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.emphasized"
      borderRadius={multi ? "2px" : "full"}
    />
  );
}

type Answer = (selection: LangyChoiceSelection) => void;

/** One option, marked when chosen or picked; a dead reference is never selectable. */
function ChoiceOption({
  option,
  refRow,
  isChosen,
  isPicked,
  open,
  answered,
  multi,
  onToggle,
}: {
  option: LangyDerivedChoicesCard["options"][number];
  refRow: ChoicesRefRow;
  isChosen: boolean;
  isPicked: boolean;
  open: boolean;
  answered: boolean;
  multi: boolean;
  onToggle: () => void;
}) {
  const dead = refRow.state === "dead";
  const marked = isChosen || isPicked;
  const selectable = open && !dead;
  const { primary, secondary } = optionRowText({ option, refRow });
  if (option.quiet === true) {
    return (
      <QuietChoiceOption
        option={option}
        marked={marked}
        selectable={selectable}
        onToggle={onToggle}
      />
    );
  }
  return (
    <chakra.button
      type="button"
      data-testid="langy-choice-option"
      data-option-id={option.id}
      disabled={!selectable}
      onClick={onToggle}
      display="flex"
      alignItems="center"
      gap={2}
      textAlign="left"
      paddingX={2}
      paddingY={1.5}
      borderWidth="1px"
      borderStyle="solid"
      borderColor={marked ? "purple.emphasized" : "border.muted"}
      borderRadius="md"
      background={marked ? "bg.muted" : "transparent"}
      cursor={selectable ? "pointer" : "default"}
      opacity={dead || (answered && !isChosen) ? 0.55 : 1}
      aria-disabled={!selectable}
      aria-pressed={marked}
      _hover={selectable ? { background: "bg.muted" } : undefined}
      transition="background 120ms ease, border-color 120ms ease"
    >
      <Box flexShrink={0} color={choiceMarkColor({ marked, dead })} display="flex">
        <ChoiceMark dead={dead} marked={marked} multi={multi} />
      </Box>
      <VStack align="stretch" gap={0} flex={1} minWidth={0}>
        <Text textStyle="xs" color={dead ? "fg.muted" : "fg"} truncate>
          {primary}
        </Text>
        {secondary ? (
          <Text textStyle="2xs" color="fg.muted" truncate>
            {secondary}
          </Text>
        ) : null}
      </VStack>
    </chakra.button>
  );
}

/** "Other…": the reader's own answer, typed, sent as the selection's other text. */
function OtherAnswer({ blockId, answer }: { blockId: string; answer: Answer }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const send = () => {
    if (trimmed !== "") answer({ blockId, optionIds: [], otherText: trimmed });
  };
  if (!editing) {
    return (
      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        color="fg.muted"
        onClick={() => setEditing(true)}
      >
        Other…
      </Button>
    );
  }
  return (
    <HStack gap={1.5}>
      <chakra.input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") send();
        }}
        placeholder="Your own answer…"
        flex={1}
        textStyle="xs"
        paddingX={2}
        paddingY={1.5}
        borderWidth="1px"
        borderStyle="solid"
        borderColor="border.muted"
        borderRadius="md"
        background="transparent"
        color="fg"
        _focus={{ borderColor: "purple.emphasized", outline: "none" }}
      />
      <Button size="xs" variant="outline" disabled={trimmed === ""} onClick={send}>
        Send
      </Button>
    </HStack>
  );
}

/** A picked set toggled one option at a time, for a multi-select card. */
function togglePick(previous: Set<string>, optionId: string): Set<string> {
  const next = new Set(previous);
  if (next.has(optionId)) next.delete(optionId);
  else next.add(optionId);
  return next;
}

/** The ask: a title, or for a bare card the reply's own prose (never inside a button). */
function ChoicesQuestion({ card }: { card: LangyDerivedChoicesCard }) {
  if (card.bare !== true) {
    return (
      <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
        {card.question}
      </Text>
    );
  }
  return (
    <Box
      data-langy-choices-prose
      paddingX="2px"
      css={{
        "& > div > :first-child": { marginTop: 0 },
        "& > div > :last-child": { marginBottom: 0 },
      }}
    >
      <Markdown fontSize="langyAnswer" linkVariant="langy" color="langy.answerFg">
        {card.question}
      </Markdown>
    </Box>
  );
}

export function LangyChoicesCard({
  card,
  lockState,
  forming = false,
  onSelect,
  refRows,
}: {
  card: LangyDerivedChoicesCard;
  lockState: LangyChoicesLockState;
  /** Still streaming — never answerable while forming. */
  forming?: boolean;
  /** Absent = read-only (time travel, shared views). */
  onSelect?: (a: { selection: LangyChoiceSelection; card: LangyDerivedChoicesCard }) => void;
  /** Fixture seam (gallery/tests): pre-resolved rows instead of fetching. */
  refRows?: ReadonlyMap<string, ChoicesRefRow>;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const answered = lockState.status === "answered";
  const superseded = lockState.status === "superseded";
  const open = lockState.status === "open" && !forming && !!onSelect;
  const multi = card.multiSelect === true;
  const chosen = new Set(lockState.status === "answered" ? lockState.optionIds : []);

  const answer: Answer = (selection) => {
    if (open) onSelect?.({ selection, card });
  };
  const toggle = (optionId: string) => {
    if (!open) return;
    if (multi) setPicked((previous) => togglePick(previous, optionId));
    else answer({ blockId: card.blockId, optionIds: [optionId] });
  };

  return (
    <VStack
      align="stretch"
      gap={1.5}
      opacity={superseded ? 0.65 : 1}
      data-langy-choices-card
      data-choices-bare={card.bare === true ? "true" : undefined}
      data-choices-forming={forming ? "true" : undefined}
    >
      <ChoicesQuestion card={card} />
      <VStack align="stretch" gap={1}>
        {card.options.map((option) => (
          <ChoiceOption
            key={option.id}
            option={option}
            refRow={refRows?.get(option.id) ?? { state: "plain" }}
            isChosen={chosen.has(option.id)}
            isPicked={picked.has(option.id)}
            open={open}
            answered={answered}
            multi={multi}
            onToggle={() => toggle(option.id)}
          />
        ))}
        {lockState.status === "answered" && lockState.otherText ? (
          <HStack gap={1.5} paddingX={2} paddingY={1}>
            <Check size={12} color="var(--chakra-colors-purple-fg)" />
            <Text textStyle="xs" color="fg">
              {lockState.otherText}
            </Text>
          </HStack>
        ) : null}
        {open && card.allowOther === true && card.bare !== true ? (
          <OtherAnswer blockId={card.blockId} answer={answer} />
        ) : null}
        {superseded ? (
          <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={0.5}>
            The conversation moved on. This question is closed.
          </Text>
        ) : null}
      </VStack>
      {open && multi ? (
        <HStack gap={2} align="center" flexWrap="wrap">
          <Button
            size="xs"
            colorPalette="orange"
            disabled={picked.size === 0}
            onClick={() => answer({ blockId: card.blockId, optionIds: [...picked] })}
          >
            <Check size={12} /> Answer
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}
