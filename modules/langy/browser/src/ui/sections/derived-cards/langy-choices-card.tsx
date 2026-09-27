/**
 * The choices card — the one sanctioned UI for the decision that belongs to the user
 * (ADR-060 §6).
 */
import { Box, Button, chakra, HStack, Text, VStack } from "@chakra-ui/react";
import type {
  LangyChoiceSelection,
  LangyChoicesLockState,
  LangyDerivedChoicesCard,
} from "@langwatch/langy-contract";
import { Check, CircleSlash } from "lucide-react";
import { useState } from "react";

import { LangyDerivedCardFrame } from "./langy-derived-card-frame.tsx";

export type ChoicesRefRow =
  | { state: "pending" }
  | { state: "plain" }
  | { state: "dead" }
  | { state: "live"; primary?: string; secondary?: string };

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
  return (
    <chakra.button
      type="button"
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
    <LangyDerivedCardFrame
      forming={forming}
      superseded={superseded}
      title={
        <Text textStyle="xs" fontWeight="640" color="fg" lineHeight="1.3">
          {card.question}
        </Text>
      }
      actions={
        open && multi ? (
          <Button
            size="xs"
            colorPalette="orange"
            disabled={picked.size === 0}
            onClick={() => answer({ blockId: card.blockId, optionIds: [...picked] })}
          >
            <Check size={12} /> Answer
          </Button>
        ) : undefined
      }
    >
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
        {open && card.allowOther === true ? (
          <OtherAnswer blockId={card.blockId} answer={answer} />
        ) : null}
        {superseded ? (
          <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={0.5}>
            The conversation moved on. This question is closed.
          </Text>
        ) : null}
      </VStack>
    </LangyDerivedCardFrame>
  );
}
