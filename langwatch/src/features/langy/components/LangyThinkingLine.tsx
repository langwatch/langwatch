import { Box, chakra, HStack, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import type { UIMessage } from "ai";
import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useCyclingVerb } from "~/features/traces-v2/components/ai/useCyclingVerb";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import {
  GLIMPSE_LIFE_MS,
  GLIMPSE_PERIOD_MS,
  nextGlimpseFragment,
} from "../logic/langyReasoningGlimpse";
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
 *   - nothing at all      → say we are still starting, and ESCALATE. Cycling
 *                           implies progress, so it stops. A stuck turn ends up
 *                           looking stuck, which is the whole point.
 *
 * The shimmer stays: it signals "alive", not "achieving".
 *
 * REASONING rides this line as a GLIMPSE (`logic/langyReasoningGlimpse.ts`):
 * every few seconds the latest complete thought fades in after the verb, holds
 * long enough to read, and dissolves — quiet between, and nothing ever moves
 * (drifting text fights the reading eye; see the logic module's doc). Clicking
 * the line opens the full reasoning scrollback; it collapses again on click or
 * when the turn settles (the store clears `reasoning`).
 */

/** Double the shared 1800ms default — a 0.28s crossfade needs time to settle. */
const THINKING_VERB_DWELL_MS = 3_600;
/** Coarse: the line only changes at 12s / 35s / 75s, so a 1s tick is plenty. */
const ELAPSED_TICK_MS = 1_000;

// One glimpse's whole life as a single keyframe run — fade in, hold, fade out —
// so the hold can never drift out of sync with a JS hide timer.
const glimpseLife = keyframes`
  0%   { opacity: 0; }
  16%  { opacity: 0.78; }
  76%  { opacity: 0.78; }
  100% { opacity: 0; }
`;

export function LangyThinkingLine({
  messages,
  reasoning = null,
}: {
  messages: UIMessage[];
  /**
   * The model's ephemeral reasoning for the live turn, accumulated from the
   * `reasoning` stream (it never becomes a message part, so it must be passed
   * in). Null when no reasoning is flowing.
   */
  reasoning?: string | null;
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

  const hasLiveReasoning = !!reasoning;
  const line = langyThinkingLine({
    messages: messages as unknown as Parameters<
      typeof langyThinkingLine
    >[0]["messages"],
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

  // ── The glimpse loop ──────────────────────────────────────────────────
  // Every GLIMPSE_PERIOD the freshest complete thought (or, failing that, a
  // taste of the newest words) surfaces once. The fragment's whole life is one
  // CSS animation; `glimpseId` keys the span so each glimpse restarts it.
  const [glimpse, setGlimpse] = useState<{
    fragment: string;
    id: number;
  } | null>(null);
  const glimpseMemory = useRef({
    lastClauseShown: null as string | null,
    lastReasoningLength: 0,
  });
  const reasoningRef = useRef(reasoning);
  reasoningRef.current = reasoning;
  useEffect(() => {
    if (!hasLiveReasoning) {
      setGlimpse(null);
      glimpseMemory.current = { lastClauseShown: null, lastReasoningLength: 0 };
      return;
    }
    let id = 0;
    const tick = () => {
      const current = reasoningRef.current;
      if (current) {
        const next = nextGlimpseFragment({
          reasoning: current,
          ...glimpseMemory.current,
        });
        if (next) {
          glimpseMemory.current = {
            lastClauseShown: next.clause,
            lastReasoningLength: current.length,
          };
          id += 1;
          setGlimpse({ fragment: next.fragment, id });
        }
      }
    };
    // The first glimpse comes early — proof of life — then settles into the
    // quiet period.
    const first = setTimeout(tick, 1_600);
    const interval = setInterval(tick, GLIMPSE_PERIOD_MS);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [hasLiveReasoning]);

  // Reduced motion: no fade — the fragment appears statically for its life and
  // is then removed (discrete change, no animation).
  useEffect(() => {
    if (!reduceMotion || !glimpse) return;
    const id = setTimeout(() => setGlimpse(null), GLIMPSE_LIFE_MS);
    return () => clearTimeout(id);
  }, [reduceMotion, glimpse]);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!hasLiveReasoning) setExpanded(false);
  }, [hasLiveReasoning]);

  // Follow the live edge of the expanded scrollback as reasoning streams.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reasoning, expanded]);

  const verb = (
    <Box
      position="relative"
      minHeight="1.5em"
      display="flex"
      alignItems="center"
      // The verb is a single nowrap line (the crossfade can't reflow mid-swap),
      // so a long tool line — "Using the GitHub skill — <the skill's whole
      // summary>" — used to run straight off the panel's right edge. Clamp it to
      // the available width and fade the cut, the same right-edge mask the
      // reasoning glimpse uses below.
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
  );

  if (!hasLiveReasoning) {
    // Stretch to the column, not shrink-to-fit: a `flex-start` box grows to the
    // verb's intrinsic nowrap width, so `maxWidth: 100%` on the verb would
    // resolve against that overgrown width and never clamp. Full width + a
    // shrinkable child is what lets the clip above engage.
    return (
      <HStack
        gap={2.5}
        alignSelf="stretch"
        width="full"
        minWidth={0}
        paddingY={0.5}
        paddingLeft={0.5}
      >
        {verb}
      </HStack>
    );
  }

  return (
    <Box alignSelf="stretch" paddingY={0.5} paddingLeft={0.5}>
      <chakra.button
        type="button"
        display="flex"
        alignItems="baseline"
        gap={2.5}
        width="full"
        textAlign="left"
        cursor="pointer"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "orange.solid",
          outlineOffset: "3px",
          borderRadius: "4px",
        }}
      >
        {verb}
        {/* The glimpse stage: static, clipped, right edge fading out. The
            fragment never moves — opacity is the only thing that animates. */}
        <Box
          flex={1}
          minWidth={0}
          overflow="hidden"
          whiteSpace="nowrap"
          css={{
            maskImage:
              "linear-gradient(to right, black 0, black calc(100% - 2em), transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, black 0, black calc(100% - 2em), transparent 100%)",
          }}
        >
          {glimpse ? (
            <Text
              key={glimpse.id}
              as="span"
              textStyle="xs"
              color="fg.muted"
              aria-live="off"
              css={
                reduceMotion
                  ? { opacity: 0.78 }
                  : {
                      opacity: 0,
                      animation: `${glimpseLife} ${GLIMPSE_LIFE_MS}ms ease-in-out forwards`,
                    }
              }
            >
              {glimpse.fragment}
            </Text>
          ) : null}
        </Box>
        <Box
          as="span"
          alignSelf="center"
          color="fg.subtle"
          transition="transform 0.18s ease"
          transform={expanded ? "rotate(90deg)" : undefined}
          flexShrink={0}
        >
          <ChevronRight size={12} />
        </Box>
      </chakra.button>

      {expanded ? (
        <Box
          ref={scrollRef}
          marginTop={2}
          maxHeight="8.5em"
          overflowY="auto"
          // Fade the top so lines scrolling out of view dissolve rather than clip.
          css={{
            maskImage:
              "linear-gradient(to bottom, transparent 0, black 1.5em, black 100%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent 0, black 1.5em, black 100%)",
            scrollbarWidth: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          <Text
            textStyle="xs"
            color="fg.muted"
            whiteSpace="pre-wrap"
            lineHeight="1.55"
          >
            {reasoning}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
