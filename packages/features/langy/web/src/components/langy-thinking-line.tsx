import { Box, HStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type {
  LangyThinkingTone,
  LangyToolNarrator,
  ThinkingMessage,
} from "../behaviour/langy-thinking-line";
import { langyThinkingLine } from "../behaviour/langy-thinking-line";
import { useCyclingVerb } from "../hooks/use-cycling-verb";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { langyThinkingShimmerStyles } from "../values/langy-shimmer";
import { LANGY_THINKING_VERBS } from "../values/langy-thinking-verbs";
import { STATUS_LINE_ROW, StatusOrb } from "./streaming-status-line";

const MotionText = motion.create(Box);

/**
 * Renders only status proved by live turn signals. Reasoning is an activity
 * signal, never displayed content; tokens already speak through the answer;
 * silence escalates honestly. The shimmer signals life rather than progress.
 */

/** Double the shared 1800ms default — a 0.28s crossfade needs time to settle. */
const THINKING_VERB_DWELL_MS = 3_600;
/** Coarse: the line only changes at 12s / 35s / 75s, so a 1s tick is plenty. */
const ELAPSED_TICK_MS = 1_000;

export function LangyThinkingLine({
  messages,
  hasLiveReasoning = false,
  workerReady = false,
  toolNarrator,
  pageActivity = null,
}: {
  messages: ThinkingMessage[];
  /**
   * The model's ephemeral reasoning is streaming right now. Reasoning deltas
   * never become message parts, so without this signal a reasoning-but-no-prose
   * turn would read as a startup wait — a false claim. The text itself is never
   * shown; see the module doc.
   */
  hasLiveReasoning?: boolean;
  /**
   * A panel-open warm proved this conversation's worker alive, so a first
   * message reads "Thinking…" instead of the startup ladder. See
   * `logic/langyThinkingLine`.
   */
  workerReady?: boolean;
  toolNarrator?: LangyToolNarrator;
  pageActivity?: string | null;
}) {
  const reduceMotion = useReducedMotion();

  // Time since this line appeared, which is when the turn went in flight (the
  // panel mounts it on `isBusy`). This is what lets silence escalate.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const line = langyThinkingLine({
    messages,
    elapsedMs,
    hasLiveReasoning,
    workerReady,
    toolNarrator,
    pageActivity,
  });

  // Whimsy ONLY where the truth signal permits it — i.e. the model is genuinely
  // generating. Everywhere else the text is the honest, static line.
  const cyclingVerb = useCyclingVerb(
    line?.allowWhimsy ?? false,
    LANGY_THINKING_VERBS,
    THINKING_VERB_DWELL_MS,
  );

  // No line at all: the streaming answer is on screen and speaks for itself —
  // any row under it (orb included) reads as the panel still waiting for the
  // reply that is visibly arriving. After the hooks, so their order is stable.
  if (!line) return null;

  const text = line.allowWhimsy ? `${cyclingVerb}…` : line.text;

  return (
    // Stretch to the column, not shrink-to-fit: a `flex-start` box grows to the
    // verb's intrinsic nowrap width, so `maxWidth: 100%` on the verb would
    // resolve against that overgrown width and never clamp. Full width + a
    // shrinkable child is what lets the clip below engage.
    //
    // The row wears the SHARED status-line frame (STATUS_LINE_ROW, see
    // StreamingStatusLine): same gap, same padding, and the same leading orb
    // slot as the status rows this line alternates with — so "Preparing Langy's
    // workspace…" → "Starting Langy…" → "Thinking…" reads as one line changing its words,
    // never a line hopping between layouts.
    <HStack
      gap={STATUS_LINE_ROW.gap}
      alignSelf="stretch"
      width="full"
      minWidth={0}
      paddingY={STATUS_LINE_ROW.paddingY}
      paddingLeft={STATUS_LINE_ROW.paddingLeft}
    >
      {/* A stuck turn keeps the slot but not the glow: the orb claims
          "alive", and by then that is the one thing we cannot claim. */}
      <StatusOrb active={line.tone !== "stuck"} />
      <ThinkingLineText text={text} tone={line.tone} reduceMotion={reduceMotion} />
    </HStack>
  );
}

/** The clamped, crossfading text half of the row. */
function ThinkingLineText({
  text,
  tone,
  reduceMotion,
}: {
  text: string;
  tone: LangyThinkingTone;
  reduceMotion: boolean;
}) {
  // A stuck turn should not shimmer like a working one — the shimmer says
  // "alive", and by this point that is the one thing we cannot claim.
  const shimmerCss =
    reduceMotion || tone === "stuck"
      ? { ...langyThinkingShimmerStyles, animation: "none" }
      : langyThinkingShimmerStyles;

  return (
    <Box
      position="relative"
      minHeight="1.5em"
      display="flex"
      alignItems="center"
      // The verb is a single nowrap line (the crossfade can't reflow mid-swap),
      // so a long tool line — "Using the GitHub skill — <the skill's whole
      // summary>" — used to run straight off the panel's right edge. Clamp it
      // to the available width and mark the cut with an ellipsis. NO fade
      // mask: it applied to short lines too, so "Thinking…" dissolved to
      // near-invisible at its tail and read as broken text, not chrome.
      flexShrink={1}
      minWidth={0}
      maxWidth="100%"
      overflow="hidden"
    >
      <AnimatePresence mode="wait" initial={false}>
        <MotionText
          key={text}
          role="status"
          aria-live="polite"
          fontSize="13px"
          fontWeight="500"
          letterSpacing="-0.005em"
          lineHeight="1.5"
          whiteSpace="nowrap"
          minWidth={0}
          maxWidth="100%"
          overflow="hidden"
          textOverflow="ellipsis"
          // The stuck line is a statement of fact, not ambient chrome: it drops
          // the gradient and reads as plain muted text.
          {...(tone === "stuck" ? { color: "fg.muted" } : { css: shimmerCss })}
          initial={reduceMotion ? false : { opacity: 0, filter: "blur(5px)", y: 5 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(5px)", y: -5 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        >
          {text}
        </MotionText>
      </AnimatePresence>
    </Box>
  );
}
