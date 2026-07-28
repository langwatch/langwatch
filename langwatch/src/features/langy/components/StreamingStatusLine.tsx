import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyTurnMetric } from "../hooks/useLangyTurnSignals";
import type { LangyProgressSample } from "../stores/langyStore";
import { LangyObserverGlyph } from "./LangyObservationState";
import { NumberTicker } from "./NumberTicker";
import { StreamingStatCard } from "./StreamingStatCard";

const MotionBox = motion.create(Box);

/**
 * ONE geometry for every pre-work / thinking / status line of a live turn.
 *
 * The startup sequence used to hop between layouts: "Starting up…" drew as the
 * bare thinking line, "Waking Langy up…" as an orb-led status row with its own
 * gap and no padding, and the first real work line flipped back — three
 * different left offsets and baselines for what reads as one evolving line.
 * Both components (LangyThinkingLine, StreamingStatusLine) now share this row
 * frame — same leading-indicator slot, same gap, same padding, same text
 * metrics — so the words change and nothing moves.
 */
export const STATUS_LINE_ROW = {
  gap: 2,
  paddingY: 0.5,
  paddingLeft: 0.5,
} as const;

/** The shared text metrics of the status/thinking line. */
export const STATUS_LINE_TEXT = {
  fontSize: "13px",
  lineHeight: "1.5",
  letterSpacing: "-0.005em",
} as const;

/**
 * The status dot, alive: a warm core with a soft halo that breathes. A moving
 * light next to "working…" copy reads as progress, so the wait feels shorter
 * than the same words beside a dead dot. Reduced motion gets a static lit orb.
 *
 * The orb is the shared leading-indicator slot of {@link STATUS_LINE_ROW}: it
 * occupies the same 10px whatever the line says, so swapping between the
 * status row and the thinking line never shifts the text. `active={false}`
 * (a stuck turn) keeps the slot but drops the glow to a static muted dot —
 * the one state that must not claim "alive".
 */
export function StatusOrb({ active = true }: { active?: boolean }) {
  const reduce = useReducedMotion();
  if (!active) {
    return (
      <Box
        data-status-orb="idle"
        position="relative"
        width="10px"
        height="10px"
        flexShrink={0}
        display="grid"
        placeItems="center"
      >
        <Box
          width="6px"
          height="6px"
          borderRadius="full"
          background="fg.subtle"
          opacity={0.6}
        />
      </Box>
    );
  }
  return (
    <Box
      data-status-orb="active"
      position="relative"
      width="10px"
      height="10px"
      flexShrink={0}
      display="grid"
      placeItems="center"
    >
      <MotionBox
        position="absolute"
        width="10px"
        height="10px"
        borderRadius="full"
        background="orange.solid"
        filter="blur(4px)"
        initial={false}
        animate={
          reduce
            ? { opacity: 0.4, scale: 1 }
            : { opacity: [0.25, 0.65, 0.25], scale: [0.85, 1.5, 0.85] }
        }
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
        }
      />
      <MotionBox
        position="relative"
        width="6px"
        height="6px"
        borderRadius="full"
        background="orange.solid"
        boxShadow="0 0 6px var(--chakra-colors-orange-solid)"
        initial={false}
        animate={reduce ? { opacity: 1 } : { opacity: [0.85, 1, 0.85] }}
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
        }
      />
    </Box>
  );
}

// DATA IS NOT THE IDENTITY GRADIENT. The homepage's Langy section runs its
// scenario bars as a flat `brand-300/70` fill over a `white/10` track — one warm
// colour, no gradient. The blue→purple→orange gradient belongs to the mark and
// the thinking line, and smearing it across a progress bar was what made these
// read as loud. `langy.barFill` / `langy.barTrack` carry the site's values.
const PROGRESS_FILL = "langy.barFill";
const PROGRESS_TRACK = "langy.barTrack";

const PROGRESS_TICK_MS = 120;
const MAX_UNCONFIRMED_PERCENT = 99;
const RATE_NEW_SAMPLE_WEIGHT = 0.35;

function normaliseProgress(progress: number): number {
  return Math.max(0, Math.min(100, progress <= 1 ? progress * 100 : progress));
}

/**
 * Smooth a measured X/Y stream between real samples.
 *
 * The first completed batch supplies `batchItems / batchDurationMs`; later
 * batches refine that rate with an EWMA so one noisy fetch cannot make the bar
 * lurch. Projection is monotonic and capped at 99% until `current === total` —
 * the client may estimate motion, but only the worker may claim completion.
 */
export function useProjectedProgress({
  progress,
  sample,
}: {
  progress: number | null | undefined;
  sample: LangyProgressSample | null | undefined;
}): number {
  const confirmed = progress == null ? 0 : normaliseProgress(progress);
  const [displayed, setDisplayed] = useState(confirmed);
  const estimate = useRef({
    current: 0,
    total: 0,
    receivedAtMs: 0,
    itemsPerMs: 0,
  });

  useEffect(() => {
    if (!sample) {
      estimate.current = {
        current: 0,
        total: 0,
        receivedAtMs: 0,
        itemsPerMs: 0,
      };
      setDisplayed(confirmed);
      return;
    }

    const previous = estimate.current;
    const sameOperation =
      previous.total === sample.total && sample.current >= previous.current;
    const observedRate =
      sample.batchItems && sample.batchDurationMs
        ? sample.batchItems / sample.batchDurationMs
        : 0;
    const itemsPerMs =
      observedRate > 0
        ? sameOperation && previous.itemsPerMs > 0
          ? previous.itemsPerMs * (1 - RATE_NEW_SAMPLE_WEIGHT) +
            observedRate * RATE_NEW_SAMPLE_WEIGHT
          : observedRate
        : sameOperation
          ? previous.itemsPerMs
          : 0;

    estimate.current = {
      current: sample.current,
      total: sample.total,
      receivedAtMs: sample.receivedAtMs,
      itemsPerMs,
    };
    setDisplayed((value) =>
      sameOperation ? Math.max(value, confirmed) : confirmed,
    );
  }, [confirmed, sample]);

  useEffect(() => {
    if (!sample || sample.current >= sample.total) {
      if (sample && sample.current === sample.total) setDisplayed(100);
      return;
    }

    const tick = () => {
      const observation = estimate.current;
      if (observation.total <= 0 || observation.itemsPerMs <= 0) return;
      const elapsedMs = Math.max(0, Date.now() - observation.receivedAtMs);
      const projectedItems =
        observation.current + elapsedMs * observation.itemsPerMs;
      const projectedPercent = Math.min(
        MAX_UNCONFIRMED_PERCENT,
        (projectedItems / observation.total) * 100,
      );
      setDisplayed((value) => Math.max(value, confirmed, projectedPercent));
    };

    tick();
    const interval = window.setInterval(tick, PROGRESS_TICK_MS);
    return () => window.clearInterval(interval);
  }, [confirmed, sample]);

  return displayed;
}

/**
 * Granular streaming state, driven by the event-sourcing turn vocabulary:
 *   - `status` (from `status_reported`, e.g. "Analysing 1,204 traces") drives a
 *     quiet status row: a brand dot + the line itself.
 *   - `metrics` (from metric events) drives a compact statcard whose numbers
 *     roll up from 0.
 *   - `progress` (from `progress_reported`, 0..1 or 0..100) drives a thin
 *     mesh-gradient bar plus a monospace percent (with an optional
 *     "· segment 7 / 11" when the turn reports segment framing).
 *
 * When none of those are present the caller shows its shimmer thinking
 * indicator instead — this component renders nothing in that case. Respects
 * `prefers-reduced-motion` (no bar spring; static ticker).
 */
export function StreamingStatusLine({
  status,
  progress,
  progressSample,
  metrics,
  segment,
}: {
  status?: string | null;
  progress?: number | null;
  progressSample?: LangyProgressSample | null;
  metrics?: LangyTurnMetric[] | null;
  segment?: { index: number; total: number } | null;
}) {
  const reduce = useReducedMotion();
  const percent = useProjectedProgress({ progress, sample: progressSample });
  const hasStatus = !!status && status.trim().length > 0;
  const hasProgress = progress !== null && progress !== undefined;
  const hasMetrics = !!metrics && metrics.length > 0;
  const isObserving = /observing the situation/i.test(status ?? "");
  if (!hasStatus && !hasProgress && !hasMetrics) return null;

  return (
    <VStack align="stretch" gap={2.5} alignSelf="stretch">
      {hasStatus ? (
        <HStack
          gap={STATUS_LINE_ROW.gap}
          align="center"
          paddingY={STATUS_LINE_ROW.paddingY}
          paddingLeft={STATUS_LINE_ROW.paddingLeft}
        >
          {isObserving ? <LangyObserverGlyph /> : <StatusOrb />}
          <Text
            {...STATUS_LINE_TEXT}
            color="fg.muted"
            role="status"
            aria-live="polite"
          >
            {status}
          </Text>
        </HStack>
      ) : null}

      {hasMetrics ? <StreamingStatCard metrics={metrics!} /> : null}

      {hasProgress ? (
        <VStack align="stretch" gap={1.5}>
          <Box
            height="6px"
            borderRadius="full"
            background={PROGRESS_TRACK}
            overflow="hidden"
          >
            <MotionBox
              height="full"
              borderRadius="full"
              background={PROGRESS_FILL}
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 120, damping: 24 }
              }
            />
          </Box>
          <HStack
            gap={1.5}
            fontFamily="mono"
            fontVariantNumeric="tabular-nums"
            textStyle="2xs"
            color="fg.muted"
          >
            <NumberTicker value={Math.round(percent)} format={(n) => `${n}%`} />
            {segment ? (
              <Text as="span">
                · {segment.index} / {segment.total}
              </Text>
            ) : null}
          </HStack>
        </VStack>
      ) : null}
    </VStack>
  );
}
