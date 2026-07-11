import { Button, chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useState } from "react";
import { useLangyFeedback } from "../data/useLangyFeedback";
import {
  type LangyFeedbackSentiment,
  markFeedbackAsked,
} from "../logic/langyFeedbackDirective";

/**
 * The four-point ordinal Langy scores each final answer on. Selecting a
 * segment is the whole signal; the label is what the customer reads.
 *
 * The backend feedback model only stores an up/down `rating` (+ sentiment)
 * today, so we DERIVE both from the ordinal: score >= 2 reads as a thumbs-up.
 *
 * TODO(backend slice): add a first-class `score` (0-3) field to the Langy
 * feedback model / event so we stop flattening this ordinal to up/down and
 * can trend "okay vs great" over time. Until then the derivation below is the
 * lossy bridge that keeps the existing data path working.
 */
const SCALE = [
  { label: "Bad", rating: "down", sentiment: "frustrated" },
  { label: "Okay", rating: "down", sentiment: "neutral" },
  { label: "Good", rating: "up", sentiment: "neutral" },
  { label: "Great", rating: "up", sentiment: "delighted" },
] as const;

/** Copy tailored to the moment Langy classified via its feedback directive. */
function promptFor(sentiment?: LangyFeedbackSentiment): string {
  switch (sentiment) {
    case "delighted":
      return "Did that land?";
    case "frustrated":
      return "That looked rough — how did Langy do?";
    default:
      return "How did Langy do?";
  }
}

/**
 * Low-chrome, four-point feedback under a completed assistant answer.
 *
 * A subtle card (hairline border, no bright fill) with four ghost segments —
 * bad / okay / good / great. Picking one reveals an optional one-line note,
 * then everything collapses to a quiet "Thanks — noted". The ordinal is
 * derived to the backend's up/down rating (see SCALE) so the data path keeps
 * working ahead of a real `score` field.
 */
export function LangyFeedback({
  conversationId,
  messageId,
  traceId,
  sentiment,
}: {
  conversationId?: string;
  messageId?: string;
  traceId?: string;
  /** The moment Langy classified this as, via its feedback directive. */
  sentiment?: LangyFeedbackSentiment;
}) {
  const { submit } = useLangyFeedback();
  const [selected, setSelected] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);

  const send = (score: number) => {
    const point = SCALE[score]!;
    submit({
      conversationId,
      messageId,
      traceId,
      rating: point.rating,
      sentiment: point.sentiment,
      comment: comment.trim() || undefined,
    });
    markFeedbackAsked();
    setDone(true);
  };

  if (done) {
    return (
      <Text textStyle="2xs" color="fg.subtle" alignSelf="flex-start">
        Thanks — noted.
      </Text>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={2.5}
      alignSelf="flex-start"
      maxWidth="100%"
      padding={2.5}
      borderRadius="lg"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      background="transparent"
    >
      <Text textStyle="2xs" color="fg.muted">
        {promptFor(sentiment)}
      </Text>
      <HStack gap={1}>
        {SCALE.map((point, score) => (
          <Segment
            key={point.label}
            isSelected={selected === score}
            onClick={() => setSelected(score)}
          >
            {point.label}
          </Segment>
        ))}
      </HStack>

      {selected !== null ? (
        <HStack gap={1.5}>
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send(selected);
              }
            }}
            placeholder="Add a note (optional)"
            size="xs"
            borderColor="border.muted"
            textStyle="2xs"
            flex={1}
          />
          <Button
            size="2xs"
            variant="outline"
            borderColor="orange.emphasized"
            color="orange.fg"
            _hover={{ background: "orange.subtle" }}
            onClick={() => send(selected)}
          >
            Send
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}

function Segment({
  children,
  isSelected,
  onClick,
}: {
  children: React.ReactNode;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      flex={1}
      paddingY={1}
      borderRadius="md"
      borderWidth="1px"
      borderStyle="solid"
      textStyle="2xs"
      fontWeight="500"
      cursor="pointer"
      transition="color 120ms ease, background 120ms ease, border-color 120ms ease"
      background={isSelected ? "orange.subtle" : "transparent"}
      color={isSelected ? "orange.fg" : "fg.muted"}
      borderColor={isSelected ? "orange.emphasized" : "border.muted"}
      _hover={
        isSelected
          ? undefined
          : { color: "fg", borderColor: "border.emphasized" }
      }
    >
      {children}
    </chakra.button>
  );
}
