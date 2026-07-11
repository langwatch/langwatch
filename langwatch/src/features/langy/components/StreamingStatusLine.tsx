import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import type { LangyTurnMetric } from "../hooks/useLangyTurnSignals";
import { NumberTicker } from "./NumberTicker";
import { StreamingStatCard } from "./StreamingStatCard";

const MotionBox = motion.create(Box);

// DATA IS NOT THE IDENTITY GRADIENT. The homepage's Langy section runs its
// scenario bars as a flat `brand-300/70` fill over a `white/10` track — one warm
// colour, no gradient. The blue→purple→orange gradient belongs to the mark and
// the thinking line, and smearing it across a progress bar was what made these
// read as loud. `langy.barFill` / `langy.barTrack` carry the site's values.
const PROGRESS_FILL = "langy.barFill";
const PROGRESS_TRACK = "langy.barTrack";

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
  metrics,
  segment,
}: {
  status?: string | null;
  progress?: number | null;
  metrics?: LangyTurnMetric[] | null;
  segment?: { index: number; total: number } | null;
}) {
  const reduce = useReducedMotion();
  const hasStatus = !!status && status.trim().length > 0;
  const hasProgress = progress !== null && progress !== undefined;
  const hasMetrics = !!metrics && metrics.length > 0;
  if (!hasStatus && !hasProgress && !hasMetrics) return null;

  // Normalise 0..1 fractions to a 0..100 percent; clamp defensively.
  const percent = hasProgress
    ? Math.max(0, Math.min(100, progress! <= 1 ? progress! * 100 : progress!))
    : 0;

  return (
    <VStack align="stretch" gap={2.5} alignSelf="stretch">
      {hasStatus ? (
        <HStack gap={2} align="center">
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            background="orange.solid"
            flexShrink={0}
          />
          <Text
            textStyle="xs"
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
                · segment {segment.index} / {segment.total}
              </Text>
            ) : null}
          </HStack>
        </VStack>
      ) : null}
    </VStack>
  );
}
