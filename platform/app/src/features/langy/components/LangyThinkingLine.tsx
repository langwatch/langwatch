import { Box, HStack, Spinner } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useCyclingVerb } from "~/features/traces-v2/components/ai/useCyclingVerb";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type {
  LangyThinkingTone,
  RecordedToolCall,
} from "../logic/langyThinkingLine";
import {
  currentTurnAssistant,
  langyThinkingLine,
  TEXT_QUIET_MS,
} from "../logic/langyThinkingLine";
import { useLangyStore } from "../stores/langyStore";
import { langyThinkingShimmerStyles } from "./langyShimmer";
import { LANGY_THINKING_VERBS } from "./langyThinkingVerbs";
import { STATUS_LINE_ROW, StatusOrb } from "./StreamingStatusLine";

const MotionText = motion.create(Box);

/**
 * The activity row at the end of the transcript while a turn is in flight
 * (card taxonomy: `activity`). It may only say TRUE things.
 *
 * It used to cycle whimsical verbs on a 3.6s timer for as long as a turn was
 * open, regardless of whether anything was happening. On a turn whose worker
 * never spawned, that meant ninety-seven seconds of "Writing a TODO list…",
 * "Calling one more tool…", "Reading the whole file…" while NOTHING was running
 * and not one token had arrived. A dead turn read as a healthy one, and "Langy
 * is slow" was diagnosed for a whole session before anyone noticed the turn had
 * never started at all.
 *
 * So the row is derived from what is provably on the wire and in the turn's
 * durable record (`logic/langyThinkingLine.ts`):
 *
 *   - a tool is running   → say which, in the reader's words ("Running the
 *                           command in your terminal", "Reading the code");
 *   - tokens are arriving → render NOTHING: the streaming answer is on screen
 *                           and speaks for itself. The row is back once the
 *                           text has been quiet for TEXT_QUIET_MS;
 *   - reasoning is flowing → "Thinking…", plainly;
 *   - between steps       → a spinner and a cycling verb;
 *   - nothing at all      → say we are still starting, and ESCALATE. Cycling
 *                           implies progress, so it stops. A stuck turn ends up
 *                           looking stuck, which is the whole point.
 *
 * REASONING IS A SIGNAL HERE, NEVER A SURFACE. `hasLiveReasoning` is the only
 * thing this component is told about the model's thinking, and it uses it for
 * exactly one purpose: to say "Thinking…" instead of falsely escalating toward
 * "stuck" on a turn that is provably working. The reasoning TEXT is deliberately
 * not rendered anywhere in the panel.
 */

/** How long each verb holds before the next one crossfades in. */
export const THINKING_VERB_DWELL_MS = 2_400;
/** Coarse: the line only changes at 12s / 35s / 75s, so a 1s tick is plenty. */
const ELAPSED_TICK_MS = 1_000;

export function LangyThinkingLine({
  messages,
  hasLiveReasoning = false,
  workerReady = false,
  awaitingAnswer = false,
  awaitingPermission = false,
  terminalConnected = false,
  activityKey = "",
  toolCalls = null,
}: {
  messages: UIMessage[];
  /**
   * A fingerprint of everything the turn has produced so far
   * (`logic/langyThinkingLine`'s `langyTurnActivityKey`). The clock below
   * restarts whenever it changes, so the escalation measures how long the turn
   * has been SILENT rather than how long it has been running.
   */
  activityKey?: string;
  /**
   * The turn's tool calls off its durable record, so a tab that adopted the
   * turn, or a local command on the developer's machine, still names the
   * running work.
   */
  toolCalls?: readonly RecordedToolCall[] | null;
  /**
   * A card is holding the turn for the developer's answer (ADR-129), so the
   * line says that instead of escalating toward "Langy may be stuck".
   */
  awaitingAnswer?: boolean;
  /** The card holding the turn is a permission ask. */
  awaitingPermission?: boolean;
  /**
   * A folder is shared from a terminal, so the ask that holds the turn is open
   * there too and the line says so.
   */
  terminalConnected?: boolean;
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
}) {
  const reduceMotion = useReducedMotion();

  // What the page Langy is driving says it is doing. Subscribed, not read
  // once: the report changes as rows come back, and the line is the only
  // place that shows it. It is also one of the turn's events, so it belongs in
  // the clock below.
  const pageActivity = useLangyStore((state) => state.pageActivity);

  // How long the turn has been silent. The clock starts when the line appears
  // and starts again on every event the turn produces, so "This is taking
  // longer than usual" and "Langy may be stuck" describe silence rather than
  // turn length. Without that, a turn running a local command for two minutes,
  // with its output arriving in the terminal, was told it may be stuck.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      ELAPSED_TICK_MS,
    );
    return () => clearInterval(id);
  }, [activityKey, pageActivity]);

  // Whether a text token arrived within the last TEXT_QUIET_MS. The parts say
  // how much prose exists, not when it came, so the growth is timed here: each
  // growth hides the row and arms one timer that shows it again. Text already
  // on the message when the row mounts (a replayed stream, a reopened tab)
  // counts as quiet, because when it arrived is unknown and the turn is
  // provably past it.
  const proseLength = proseLengthOf(messages);
  const seenProseLengthRef = useRef<number | null>(null);
  const [proseArriving, setProseArriving] = useState(false);
  useEffect(() => {
    const seen = seenProseLengthRef.current;
    seenProseLengthRef.current = proseLength;
    if (seen === null || proseLength <= seen) return;
    setProseArriving(true);
    const id = setTimeout(() => setProseArriving(false), TEXT_QUIET_MS);
    return () => clearTimeout(id);
  }, [proseLength]);

  const line = langyThinkingLine({
    messages,
    elapsedMs,
    hasLiveReasoning,
    workerReady,
    pageActivity,
    awaitingAnswer,
    awaitingPermission,
    terminalConnected,
    proseArriving,
    toolCalls,
  });

  // The verbs cycle ONLY where the truth signal permits it, which is while
  // the model is genuinely working. Everywhere else the text is the static
  // line.
  const cyclingVerb = useCyclingVerb(
    line?.allowWhimsy ?? false,
    LANGY_THINKING_VERBS,
    THINKING_VERB_DWELL_MS,
  );

  // No line at all: the streaming answer is on screen and speaks for itself —
  // any row under it (spinner included) reads as the panel still waiting for
  // the reply that is visibly arriving. After the hooks, so their order is stable.
  if (!line) return null;

  const text = line.allowWhimsy ? `${cyclingVerb}…` : line.text;

  return (
    // Stretch to the column, not shrink-to-fit: a `flex-start` box grows to the
    // verb's intrinsic nowrap width, so `maxWidth: 100%` on the verb would
    // resolve against that overgrown width and never clamp. Full width + a
    // shrinkable child is what lets the clip below engage.
    //
    // The row wears the SHARED status-line frame (STATUS_LINE_ROW, see
    // StreamingStatusLine): same gap, same padding, and the same leading
    // indicator slot as the status rows this line alternates with, so
    // "Preparing Langy's workspace…" → "Starting Langy…" → "Thinking…" reads
    // as one line changing its words, never a line hopping between layouts.
    <HStack
      gap={STATUS_LINE_ROW.gap}
      alignSelf="stretch"
      width="full"
      minWidth={0}
      paddingY={STATUS_LINE_ROW.paddingY}
      paddingLeft={STATUS_LINE_ROW.paddingLeft}
      data-langy-activity-row=""
    >
      {/* A working turn spins; a waiting one glows; a stuck turn keeps the
          slot but not the glow: the indicator claims "alive", and by then
          that is the one thing we cannot claim. */}
      {line.tone === "working" ? (
        <ActivitySpinner reduceMotion={reduceMotion} />
      ) : (
        <StatusOrb active={line.tone !== "stuck"} />
      )}
      <ThinkingLineText
        text={text}
        tone={line.tone}
        reduceMotion={reduceMotion}
      />
    </HStack>
  );
}

/** The prose of the current turn's reply so far, as a length. */
function proseLengthOf(messages: UIMessage[]): number {
  const parts = currentTurnAssistant(messages)?.parts ?? [];
  return parts.reduce(
    (total, part) =>
      total + (part.type === "text" ? (part.text?.length ?? 0) : 0),
    0,
  );
}

/**
 * The spinner of a working turn. It sits in the same 10px slot as the status
 * orb, so the text keeps one left offset whichever indicator leads the row.
 */
function ActivitySpinner({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <Box
      data-status-orb="active"
      data-langy-activity-spinner=""
      position="relative"
      width="10px"
      height="10px"
      flexShrink={0}
      display="grid"
      placeItems="center"
    >
      <Spinner
        width="10px"
        height="10px"
        borderWidth="1.5px"
        color="fg.muted"
        css={reduceMotion ? { animation: "none" } : undefined}
      />
    </Box>
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
          initial={
            reduceMotion ? false : { opacity: 0, filter: "blur(5px)", y: 5 }
          }
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, filter: "blur(5px)", y: -5 }
          }
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        >
          {text}
        </MotionText>
      </AnimatePresence>
    </Box>
  );
}
