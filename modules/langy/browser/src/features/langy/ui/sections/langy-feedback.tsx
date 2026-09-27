import { chakra, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useLangyStore, useReducedMotion, ACCENT, CARD } from "@langwatch/langy-browser-kit";
import { ArrowRight, X } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { type LangyFeedbackSentiment } from "../../../../model/langy-feedback-directive.ts";
import { useLangyFeedback } from "../../behavior/data/use-langy-feedback.ts";

/** What the backend feedback capture accepts as the coarse rating + tone. */
type FeedbackRating = "up" | "down";
type FeedbackSentiment = "frustrated" | "delighted" | "neutral";

/**
 * The four-point ordinal Langy scores each final answer on. Selecting a segment is the
 * whole signal; the label is what the customer reads.
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

type FeedbackOrigin = "asked" | "directive" | "requested" | "preview";

/**
 * The card's life: pinned on first render (so the refetch after the shown-mark can't unmount it
 * mid-look, and a card already waved away stays away), the server's quiet period started once the
 * project is known, and a rating or "Not now" remembered so a remount cannot resurrect it.
 */
function useFeedbackCard({
  conversationId,
  messageId,
  traceId,
  origin,
}: {
  conversationId: string | undefined;
  messageId: string | undefined;
  traceId: string | undefined;
  origin: FeedbackOrigin;
}) {
  const { submit } = useLangyFeedback();
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;
  const promptShown = api.langy.feedbackPromptShown.useMutation();
  const dismissedIds = useLangyStore((s) => s.dismissedFeedbackMessageIds);
  const dismissFeedback = useLangyStore((s) => s.dismissFeedback);
  const [done, setDone] = useState(false);
  const [locallyDismissed, setLocallyDismissed] = useState(false);
  const live = origin !== "preview";
  const wasDismissed = () =>
    !!messageId && useLangyStore.getState().dismissedFeedbackMessageIds.has(messageId);

  const pin = useEffectEvent(() => {
    if (live && messageId && !wasDismissed()) useLangyStore.getState().pinFeedback(messageId);
  });
  useEffect(() => pin(), []);

  // Showing IS asking: an ignored card must not re-ask under the next answer. Keyed on the
  // project, which can resolve a beat after the card renders; the ref makes it exactly-once.
  const markedShownRef = useRef(false);
  const markShown = useEffectEvent(() => {
    const asks = live && origin !== "requested";
    if (!asks || markedShownRef.current) return;
    if (!conversationId || !projectId || wasDismissed()) return;
    markedShownRef.current = true;
    promptShown.mutate({ projectId, conversationId });
  });
  useEffect(() => markShown(), [projectId]);

  /**
   * Persist one rating, then collapse the card. A rating starts the quiet period for EVERY live
   * origin, `/feedback` included, and marks the answer handled.
   */
  const record = (rating: {
    rating: FeedbackRating;
    sentiment: FeedbackSentiment;
    comment?: string;
  }) => {
    submit({ conversationId, messageId, traceId, ...rating });
    if (live && conversationId && projectId) promptShown.mutate({ projectId, conversationId });
    if (live && messageId) dismissFeedback(messageId);
    setDone(true);
  };

  /** "Not now": remembered, so the card can't reappear when the conversation re-renders. */
  const dismiss = () => {
    if (messageId) dismissFeedback(messageId);
    setLocallyDismissed(true);
  };

  // `messageId` is optional, so a local flag keeps the card dismissible without one.
  const hidden = locallyDismissed || (!!messageId && dismissedIds.has(messageId));
  return { done, hidden, record, dismiss };
}

/** A typed 1-5 score, or nothing when the field does not hold one. */
function typedScore(typed: string): { valid: true; score: number } | { valid: false } {
  const parsed = Number(typed);
  const valid =
    typed.trim() !== "" && Number.isFinite(parsed) && parsed >= TYPED_MIN && parsed <= TYPED_MAX;
  return valid ? { valid: true, score: Math.round(parsed) } : { valid: false };
}

/**
 * Low-chrome, four-point feedback under a completed assistant answer. "Thanks, noted." wins over
 * the dismissal memory: rating also records the message as handled.
 */
export function LangyFeedback({
  conversationId,
  messageId,
  traceId,
  sentiment,
  origin = "asked",
}: {
  conversationId?: string;
  messageId?: string;
  traceId?: string;
  /** The moment Langy classified this as, via its feedback directive. */
  sentiment?: LangyFeedbackSentiment;
  /**
   * How this card came to be: the backend cadence ("asked"), the agent's directive ("directive"),
   * `/feedback` ("requested"), or the dev card gallery ("preview" — fully inert).
   */
  origin?: FeedbackOrigin;
}) {
  const reduce = useReducedMotion();
  const card = useFeedbackCard({ conversationId, messageId, traceId, origin });

  if (card.done) {
    return (
      <Text textStyle="2xs" color="fg.subtle" alignSelf="flex-start" paddingY={1}>
        Thanks, noted.
      </Text>
    );
  }
  if (card.hidden) return null;

  return (
    <MotionDiv
      style={{ width: "100%" }}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
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
        // A restrained warm hairline + a barely-there accent wash: the Langy card language.
        borderColor={CARD.accentBorder}
        background="transparent"
        backgroundImage={CARD.accentWash}
      >
        {/* The prompt shares its row with the way out: a ✕ keeps the rating rail unbroken. */}
        <HStack gap={2} width="full" align="center">
          <Text textStyle="2xs" color="fg.muted" letterSpacing="-0.005em" flex={1}>
            {promptFor(sentiment)}
          </Text>
          <chakra.button
            type="button"
            aria-label="Dismiss feedback request"
            onClick={card.dismiss}
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
          {SCALE.map((point) => (
            <Segment
              key={point.label}
              onClick={() => card.record({ rating: point.rating, sentiment: point.sentiment })}
            >
              {point.label}
            </Segment>
          ))}
        </HStack>
        <TypedScore onRate={card.record} />
      </VStack>
    </MotionDiv>
  );
}

/**
 * A sharper signal for anyone who wants it: a typed 1-5 score, derived to the same up/down the
 * segments give, with the exact number riding in `comment` until a score field lands.
 */
function TypedScore({
  onRate,
}: {
  onRate: (rating: {
    rating: FeedbackRating;
    sentiment: FeedbackSentiment;
    comment: string;
  }) => void;
}) {
  const [typed, setTyped] = useState("");
  const score = typedScore(typed);
  const send = () => {
    if (!score.valid) return;
    const { rating, sentiment } = deriveFromTypedScore(score.score);
    onRate({ rating, sentiment, comment: `Rated ${score.score} out of ${TYPED_MAX}` });
  };
  return (
    <HStack gap={2} width="full" align="center">
      <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
        Or type a score
      </Text>
      <Input
        value={typed}
        onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, "").slice(0, 1))}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          send();
        }}
        aria-label={`Rate Langy from ${TYPED_MIN} to ${TYPED_MAX}`}
        inputMode="numeric"
        placeholder={`${TYPED_MIN}-${TYPED_MAX}`}
        size="xs"
        width="44px"
        textAlign="center"
        borderColor="border.muted"
        _focusVisible={{ borderColor: "orange.emphasized", outline: "none", boxShadow: "none" }}
      />
      <chakra.button
        type="button"
        aria-label="Submit typed rating"
        onClick={send}
        disabled={!score.valid}
        display="grid"
        placeItems="center"
        width="24px"
        height="24px"
        borderRadius="full"
        borderWidth={0}
        flexShrink={0}
        background={score.valid ? "orange.subtle" : "transparent"}
        color={score.valid ? ACCENT : "fg.subtle"}
        cursor={score.valid ? "pointer" : "default"}
        opacity={score.valid ? 1 : 0.5}
        transition="background 120ms ease, color 120ms ease, opacity 120ms ease"
      >
        <ArrowRight size={13} />
      </chakra.button>
    </HStack>
  );
}

function Segment({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
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
