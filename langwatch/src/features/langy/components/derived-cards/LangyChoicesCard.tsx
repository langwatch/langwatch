/**
 * The choices card — the one sanctioned UI for the decision that belongs to
 * the user (ADR-060 §6). Options render as real, tappable rows; entity refs
 * arrive hydrated AS THE VIEWER (a dead ref renders disabled — the model
 * cannot make you pick a thing that isn't there); and every state the card
 * can be in is DERIVED from the recorded conversation:
 *
 *   open        the question is the conversation's latest exchange
 *   answered    a recorded selection exists — locked, choice marked, forever
 *   superseded  anything else followed — grayed, readable, unanswerable
 *
 * No client-only flags, no timers: the same derivation replays in time
 * travel, where `onSelect` is simply absent and the card is read-only.
 *
 * Selecting sends the answer as the NEXT USER MESSAGE (structured part +
 * readable text) through the ordinary send path — the turn machinery is
 * untouched by construction.
 */
import { Box, Button, HStack, Text, VStack, chakra } from "@chakra-ui/react";
import type {
  LangyDerivedChoicesCard,
  LangyChoiceSelection,
  LangyChoicesLockState,
} from "@langwatch/langy";
import { Check, CircleSlash } from "lucide-react";
import { useState } from "react";

import { LangyDerivedCardFrame } from "./LangyDerivedCardFrame";
import { useChoicesRefRows, type ChoicesRefRow } from "./useChoicesRefRows";

export function LangyChoicesCard({
  card,
  lockState,
  forming = false,
  onSelect,
  refRowsOverride,
}: {
  card: LangyDerivedChoicesCard;
  lockState: LangyChoicesLockState;
  /** Still streaming — never answerable while forming. */
  forming?: boolean;
  /** Absent = read-only (time travel, shared views). */
  onSelect?: (a: {
    selection: LangyChoiceSelection;
    card: LangyDerivedChoicesCard;
  }) => void;
  /** Fixture seam (gallery/tests): pre-resolved rows instead of fetching. */
  refRowsOverride?: ReadonlyMap<string, ChoicesRefRow>;
}) {
  const hydratedRows = useChoicesRefRows(
    refRowsOverride ? [] : card.options,
  );
  const refRows = refRowsOverride ?? hydratedRows;
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");

  const answered = lockState.status === "answered";
  const superseded = lockState.status === "superseded";
  const open = lockState.status === "open" && !forming && !!onSelect;
  const multi = card.multiSelect === true;

  const answer = (selection: LangyChoiceSelection): void => {
    if (!open || !onSelect) return;
    onSelect({ selection, card });
  };

  const toggle = (optionId: string): void => {
    if (!open) return;
    if (!multi) {
      answer({ blockId: card.blockId, optionIds: [optionId] });
      return;
    }
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  };

  const chosen = new Set(answered ? lockState.optionIds : []);

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
            onClick={() =>
              answer({ blockId: card.blockId, optionIds: [...picked] })
            }
          >
            <Check size={12} /> Answer
          </Button>
        ) : undefined
      }
    >
      <VStack align="stretch" gap={1}>
        {card.options.map((option) => {
          const refRow = refRows.get(option.id) ?? { state: "plain" as const };
          const dead = refRow.state === "dead";
          const isChosen = chosen.has(option.id);
          const isPicked = picked.has(option.id);
          const selectable = open && !dead;

          const primary =
            refRow.state === "live" && refRow.primary
              ? refRow.primary
              : option.label;
          const secondary = dead
            ? "No longer exists"
            : (refRow.state === "live" ? refRow.secondary : undefined) ??
              option.description;

          return (
            <chakra.button
              key={option.id}
              type="button"
              disabled={!selectable}
              onClick={() => toggle(option.id)}
              display="flex"
              alignItems="center"
              gap={2}
              textAlign="left"
              paddingX={2}
              paddingY={1.5}
              borderWidth="1px"
              borderStyle="solid"
              borderColor={
                isChosen || isPicked ? "purple.emphasized" : "border.muted"
              }
              borderRadius="md"
              background={isChosen || isPicked ? "bg.muted" : "transparent"}
              cursor={selectable ? "pointer" : "default"}
              opacity={dead || (answered && !isChosen) ? 0.55 : 1}
              aria-disabled={!selectable}
              aria-pressed={isChosen || isPicked}
              _hover={selectable ? { background: "bg.muted" } : undefined}
              transition="background 120ms ease, border-color 120ms ease"
            >
              <Box
                flexShrink={0}
                color={
                  isChosen || isPicked
                    ? "purple.fg"
                    : dead
                      ? "fg.subtle"
                      : "fg.muted"
                }
                display="flex"
              >
                {dead ? (
                  <CircleSlash size={13} />
                ) : isChosen || isPicked ? (
                  <Check size={13} />
                ) : (
                  <Box
                    width="11px"
                    height="11px"
                    borderWidth="1px"
                    borderStyle="solid"
                    borderColor="border.emphasized"
                    borderRadius={multi ? "2px" : "full"}
                  />
                )}
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
        })}

        {answered && lockState.otherText ? (
          <HStack gap={1.5} paddingX={2} paddingY={1}>
            <Check size={12} color="var(--chakra-colors-purple-fg)" />
            <Text textStyle="xs" color="fg">
              {lockState.otherText}
            </Text>
          </HStack>
        ) : null}

        {open && card.allowOther === true ? (
          otherOpen ? (
            <HStack gap={1.5}>
              <chakra.input
                autoFocus
                value={otherText}
                onChange={(event) => setOtherText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || otherText.trim() === "") return;
                  answer({
                    blockId: card.blockId,
                    optionIds: [],
                    otherText: otherText.trim(),
                  });
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
              <Button
                size="xs"
                variant="outline"
                disabled={otherText.trim() === ""}
                onClick={() =>
                  answer({
                    blockId: card.blockId,
                    optionIds: [],
                    otherText: otherText.trim(),
                  })
                }
              >
                Send
              </Button>
            </HStack>
          ) : (
            <Button
              size="xs"
              variant="ghost"
              alignSelf="flex-start"
              color="fg.muted"
              onClick={() => setOtherOpen(true)}
            >
              Other…
            </Button>
          )
        ) : null}

        {superseded ? (
          <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={0.5}>
            The conversation moved on — this question is closed.
          </Text>
        ) : null}
      </VStack>
    </LangyDerivedCardFrame>
  );
}
