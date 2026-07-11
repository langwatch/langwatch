import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { X } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyFeedback } from "../data/useLangyFeedback";
import { useLangyStore } from "../stores/langyStore";
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

const MotionDiv = motion.create("div");

/**
 * Low-chrome, four-point feedback under a completed assistant answer.
 *
 * A quiet card — hairline border, no bright fill — with four evenly-spaced
 * ghost segments (bad / okay / good / great) that go muted → foreground on
 * hover and flash the soft brand accent as you pick. One tap is the whole
 * interaction: it submits and the card collapses to a small "Thanks — noted",
 * so it never lingers or nags. The ordinal is derived to the backend's up/down
 * rating (see SCALE) ahead of a real `score` field. Enters with a whisper of a
 * fade; static under `prefers-reduced-motion`.
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
  const reduce = useReducedMotion();
  const [done, setDone] = useState(false);
  const dismissedIds = useLangyStore((s) => s.dismissedFeedbackMessageIds);
  const dismissFeedback = useLangyStore((s) => s.dismissFeedback);
  const [locallyDismissed, setLocallyDismissed] = useState(false);

  const send = (score: number) => {
    const point = SCALE[score]!;
    submit({
      conversationId,
      messageId,
      traceId,
      rating: point.rating,
      sentiment: point.sentiment,
    });
    markFeedbackAsked();
    setDone(true);
  };

  /**
   * "Not now." The card had no exit before — you either rated the answer or
   * lived with it sitting there. Dismissing records the ask against the long
   * snooze (so the next turn doesn't just ask again) AND remembers this
   * message, so the card can't reappear when the conversation re-renders or is
   * reloaded from history.
   */
  const dismiss = () => {
    markFeedbackAsked();
    if (messageId) dismissFeedback(messageId);
    setLocallyDismissed(true);
  };

  // `messageId` is optional in the contract, so keep a local flag too — the
  // card must be dismissible even when it has nothing to key the memory on.
  if (locallyDismissed || (messageId && dismissedIds.has(messageId))) {
    return null;
  }

  if (done) {
    return (
      <Text
        textStyle="2xs"
        color="fg.subtle"
        alignSelf="flex-start"
        paddingY={1}
      >
        Thanks — noted.
      </Text>
    );
  }

  return (
    <MotionDiv
      style={{ width: "100%" }}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduce ? { duration: 0 } : { duration: 0.28, ease: [0.32, 0.72, 0, 1] }
      }
    >
      <VStack
        align="stretch"
        gap={2.5}
        width="full"
        maxWidth="100%"
        paddingX={3}
        paddingY={2.5}
        borderRadius="langyCard"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="border.muted"
        background="transparent"
      >
        {/* The prompt shares its row with the way out. A ✕ (rather than a "Not
            now" button) keeps the four-segment rail below it unbroken and reads
            as the same dismiss gesture used everywhere else in the panel. */}
        <HStack gap={2} width="full" align="center">
          <Text
            textStyle="2xs"
            color="fg.muted"
            letterSpacing="-0.005em"
            flex={1}
          >
            {promptFor(sentiment)}
          </Text>
          <chakra.button
            type="button"
            aria-label="Dismiss feedback request"
            onClick={dismiss}
            display="grid"
            placeItems="center"
            borderRadius="full"
            width="18px"
            height="18px"
            flexShrink={0}
            color="fg.subtle"
            cursor="pointer"
            transition="color 120ms ease, background 120ms ease"
            _hover={{ color: "fg", background: "bg.muted" }}
          >
            <X size={12} />
          </chakra.button>
        </HStack>
        <HStack gap={1.5} width="full">
          {SCALE.map((point, score) => (
            <Segment key={point.label} onClick={() => send(score)}>
              {point.label}
            </Segment>
          ))}
        </HStack>
      </VStack>
    </MotionDiv>
  );
}

function Segment({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      flex={1}
      paddingY={1.5}
      borderRadius="md"
      borderWidth="1px"
      borderStyle="solid"
      textStyle="2xs"
      fontWeight="500"
      cursor="pointer"
      transition="color 120ms ease, background 120ms ease, border-color 120ms ease"
      background="transparent"
      color="fg.muted"
      borderColor="border.muted"
      _hover={{
        color: "fg",
        background: "bg.muted",
        borderColor: "border.emphasized",
      }}
      _active={{
        color: "orange.fg",
        background: "orange.subtle",
        borderColor: "orange.emphasized",
      }}
    >
      {children}
    </chakra.button>
  );
}
