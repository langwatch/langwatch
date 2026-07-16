import { chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { ArrowRight, X } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useState } from "react";
import { ACCENT, CARD } from "~/features/asaplangy/tokens";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { useLangyFeedback } from "../data/useLangyFeedback";
import { useLangyStore } from "../stores/langyStore";
import {
  type LangyFeedbackSentiment,
  markFeedbackAsked,
} from "../logic/langyFeedbackDirective";

/** What the backend feedback capture accepts as the coarse rating + tone. */
type FeedbackRating = "up" | "down";
type FeedbackSentiment = "frustrated" | "delighted" | "neutral";

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
 * lossy bridge that keeps the existing data path working — the exact number a
 * customer types (see the 1-5 field) rides along in `comment` so it isn't lost.
 */
const SCALE: {
  label: string;
  rating: FeedbackRating;
  sentiment: FeedbackSentiment;
}[] = [
  { label: "Bad", rating: "down", sentiment: "frustrated" },
  { label: "Okay", rating: "down", sentiment: "neutral" },
  { label: "Good", rating: "up", sentiment: "neutral" },
  { label: "Great", rating: "up", sentiment: "delighted" },
];

/** The typed rating is a familiar 1-5 scale, derived to the backend's shape. */
const TYPED_MIN = 1;
const TYPED_MAX = 5;

function deriveFromTypedScore(score: number): {
  rating: FeedbackRating;
  sentiment: FeedbackSentiment;
} {
  if (score <= 1) return { rating: "down", sentiment: "frustrated" };
  if (score === 2) return { rating: "down", sentiment: "neutral" };
  if (score >= 5) return { rating: "up", sentiment: "delighted" };
  return { rating: "up", sentiment: "neutral" };
}

/** Copy tailored to the moment Langy classified via its feedback directive. */
function promptFor(sentiment?: LangyFeedbackSentiment): string {
  switch (sentiment) {
    case "delighted":
      return "Did that land?";
    case "frustrated":
      return "That looked rough. How did Langy do?";
    default:
      return "How did Langy do?";
  }
}

const MotionDiv = motion.create("div");

/**
 * Low-chrome, four-point feedback under a completed assistant answer.
 *
 * A quiet card wearing the Langy card language (the asaplangy `CARD` tokens: a
 * restrained warm hairline, a whisper of accent wash, no bright fill) with four
 * evenly-spaced ghost segments (bad / okay / good / great) that go muted →
 * foreground on hover and flash the soft brand accent as you pick. One tap is
 * the whole interaction: it submits and the card collapses to a small "Thanks,
 * noted", so it never lingers or nags. For a sharper signal there is also an
 * inline 1-5 field you can type into. The ordinal (and the exact typed number)
 * is recorded through the backend feedback capture. Enters with a whisper of a
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
  const [typed, setTyped] = useState("");
  const dismissedIds = useLangyStore((s) => s.dismissedFeedbackMessageIds);
  const dismissFeedback = useLangyStore((s) => s.dismissFeedback);
  const [locallyDismissed, setLocallyDismissed] = useState(false);

  /** Persist one rating, then collapse the card. */
  const record = ({
    rating,
    sentiment: tone,
    comment,
  }: {
    rating: FeedbackRating;
    sentiment: FeedbackSentiment;
    comment?: string;
  }) => {
    submit({
      conversationId,
      messageId,
      traceId,
      rating,
      sentiment: tone,
      ...(comment ? { comment } : {}),
    });
    markFeedbackAsked();
    setDone(true);
  };

  const sendSegment = (index: number) => {
    const point = SCALE[index]!;
    record({ rating: point.rating, sentiment: point.sentiment });
  };

  const parsedTyped = Number(typed);
  const typedValid =
    typed.trim() !== "" &&
    Number.isFinite(parsedTyped) &&
    parsedTyped >= TYPED_MIN &&
    parsedTyped <= TYPED_MAX;

  const sendTyped = () => {
    if (!typedValid) return;
    const score = Math.round(parsedTyped);
    const { rating, sentiment: tone } = deriveFromTypedScore(score);
    // The exact number rides in `comment` so the finer signal survives the
    // lossy up/down derivation until a first-class score field lands.
    record({
      rating,
      sentiment: tone,
      comment: `Rated ${score} out of ${TYPED_MAX}`,
    });
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
        Thanks, noted.
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
        borderRadius={CARD.radius}
        borderWidth={CARD.borderWidth}
        borderStyle="solid"
        // A restrained warm hairline + a barely-there accent wash: the Langy
        // card language, not a bright orange ring (see asaplangy tokens).
        borderColor={CARD.accentBorder}
        background="transparent"
        backgroundImage={CARD.accentWash}
      >
        {/* The prompt shares its row with the way out. A ✕ (rather than a "Not
            now" button) keeps the rating rail below it unbroken and reads as the
            same dismiss gesture used everywhere else in the panel. */}
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
          {SCALE.map((point, index) => (
            <Segment key={point.label} onClick={() => sendSegment(index)}>
              {point.label}
            </Segment>
          ))}
        </HStack>
        {/* A sharper signal for anyone who wants it: type a 1-5 score. It
            derives to the same up/down the segments do, and carries the exact
            number along so nothing is thrown away. */}
        <HStack gap={2} width="full" align="center">
          <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
            Or type a score
          </Text>
          <Input
            value={typed}
            onChange={(e) =>
              setTyped(e.target.value.replace(/[^\d]/g, "").slice(0, 1))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                sendTyped();
              }
            }}
            aria-label={`Rate Langy from ${TYPED_MIN} to ${TYPED_MAX}`}
            inputMode="numeric"
            placeholder={`${TYPED_MIN}-${TYPED_MAX}`}
            size="xs"
            width="44px"
            textAlign="center"
            borderColor="border.muted"
            _focusVisible={{
              borderColor: "orange.emphasized",
              outline: "none",
              boxShadow: "none",
            }}
          />
          <chakra.button
            type="button"
            aria-label="Submit typed rating"
            onClick={sendTyped}
            disabled={!typedValid}
            display="grid"
            placeItems="center"
            width="24px"
            height="24px"
            borderRadius="full"
            borderWidth={0}
            flexShrink={0}
            background={typedValid ? "orange.subtle" : "transparent"}
            color={typedValid ? ACCENT : "fg.subtle"}
            cursor={typedValid ? "pointer" : "default"}
            opacity={typedValid ? 1 : 0.5}
            transition="background 120ms ease, color 120ms ease, opacity 120ms ease"
          >
            <ArrowRight size={13} />
          </chakra.button>
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
        color: ACCENT,
        background: "orange.subtle",
        borderColor: "orange.emphasized",
      }}
    >
      {children}
    </chakra.button>
  );
}
