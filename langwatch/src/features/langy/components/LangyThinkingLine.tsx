import { Box, HStack } from "@chakra-ui/react";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useCyclingVerb } from "~/features/traces-v2/components/ai/useCyclingVerb";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { langyThinkingLine } from "../logic/langyThinkingLine";
import { LANGY_THINKING_VERBS } from "./langyThinkingVerbs";
import { langyThinkingShimmerStyles } from "./langyShimmer";

const MotionText = motion.create(Box);

/**
 * The line Langy shows while a turn is in flight — and it may only say TRUE
 * things.
 *
 * It used to cycle whimsical verbs on a 3.6s timer for as long as a turn was
 * open, regardless of whether anything was happening. On a turn whose worker
 * never spawned, that meant ninety-seven seconds of "Writing a TODO list…",
 * "Calling one more tool…", "Reading the whole file…" while NOTHING was running
 * and not one token had arrived. A dead turn read as a healthy one, and "Langy
 * is slow" was diagnosed for a whole session before anyone noticed the turn had
 * never started at all.
 *
 * So the line is now derived from what is provably on the wire
 * (`logic/langyThinkingLine.ts`):
 *
 *   - a tool is running   → say which, from the tool stream's own command;
 *   - tokens are arriving → "Writing…", and whimsy is allowed, because the model
 *                           really is thinking and a joke about its character
 *                           claims nothing about the work;
 *   - reasoning is flowing → "Thinking…", plainly;
 *   - nothing at all      → say we are still starting, and ESCALATE. Cycling
 *                           implies progress, so it stops. A stuck turn ends up
 *                           looking stuck, which is the whole point.
 *
 * The shimmer stays: it signals "alive", not "achieving".
 *
 * REASONING IS A SIGNAL HERE, NEVER A SURFACE. `hasLiveReasoning` is the only
 * thing this component is told about the model's thinking, and it uses it for
 * exactly one purpose: to say "Thinking…" instead of falsely escalating toward
 * "stuck" on a turn that is provably working. The reasoning TEXT is deliberately
 * not rendered anywhere in the panel — it used to ride this line as a fading
 * glimpse with an expandable scrollback, and it is gone. The store still
 * accumulates it (it drives the fold's `thinking` motion); the UI simply does
 * not show the model's private thinking to the user.
 */

/** Double the shared 1800ms default — a 0.28s crossfade needs time to settle. */
const THINKING_VERB_DWELL_MS = 3_600;
/** Coarse: the line only changes at 12s / 35s / 75s, so a 1s tick is plenty. */
const ELAPSED_TICK_MS = 1_000;

export function LangyThinkingLine({
  messages,
  hasLiveReasoning = false,
}: {
  messages: UIMessage[];
  /**
   * The model's ephemeral reasoning is streaming right now. Reasoning deltas
   * never become message parts, so without this signal a reasoning-but-no-prose
   * turn would read as "Starting up…" — a false claim. The text itself is never
   * shown; see the module doc.
   */
  hasLiveReasoning?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  // Time since this line appeared, which is when the turn went in flight (the
  // panel mounts it on `isBusy`). This is what lets silence escalate.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      ELAPSED_TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  const line = langyThinkingLine({
    messages,
    elapsedMs,
    hasLiveReasoning,
  });

  // Whimsy ONLY where the truth signal permits it — i.e. the model is genuinely
  // generating. Everywhere else the text is the honest, static line.
  const cyclingVerb = useCyclingVerb(
    line.allowWhimsy,
    LANGY_THINKING_VERBS,
    THINKING_VERB_DWELL_MS,
  );
  const text = line.allowWhimsy ? `${cyclingVerb}…` : line.text;

  // A stuck turn should not shimmer like a working one — the shimmer says
  // "alive", and by this point that is the one thing we cannot claim.
  const shimmerCss =
    reduceMotion || line.tone === "stuck"
      ? { ...langyThinkingShimmerStyles, animation: "none" }
      : langyThinkingShimmerStyles;

  return (
    // Stretch to the column, not shrink-to-fit: a `flex-start` box grows to the
    // verb's intrinsic nowrap width, so `maxWidth: 100%` on the verb would
    // resolve against that overgrown width and never clamp. Full width + a
    // shrinkable child is what lets the clip below engage.
    <HStack
      gap={2.5}
      alignSelf="stretch"
      width="full"
      minWidth={0}
      paddingY={0.5}
      paddingLeft={0.5}
    >
      <Box
        position="relative"
        minHeight="1.5em"
        display="flex"
        alignItems="center"
        // The verb is a single nowrap line (the crossfade can't reflow mid-swap),
        // so a long tool line — "Using the GitHub skill — <the skill's whole
        // summary>" — used to run straight off the panel's right edge. Clamp it to
        // the available width and fade the cut.
        flexShrink={1}
        minWidth={0}
        maxWidth="100%"
        overflow="hidden"
        css={{
          maskImage:
            "linear-gradient(to right, black 0, black calc(100% - 1.5em), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black 0, black calc(100% - 1.5em), transparent 100%)",
        }}
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
            // The stuck line is a statement of fact, not ambient chrome: it drops
            // the gradient and reads as plain muted text.
            {...(line.tone === "stuck"
              ? { color: "fg.muted" }
              : { css: shimmerCss })}
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
    </HStack>
  );
}
