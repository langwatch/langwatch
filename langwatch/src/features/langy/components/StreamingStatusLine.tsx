import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import {
  SparkleTile,
  thinkingShimmerStyles,
} from "~/features/traces-v2/components/ai/aiBrandVisuals";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { NumberTicker } from "./NumberTicker";

const MotionBox = motion.create(Box);

/**
 * Granular streaming state, driven by the event-sourcing turn vocabulary:
 *   - `status` (from `status_reported`, e.g. "Analysing 1,204 traces") drives
 *     a live, shimmering status line.
 *   - `progress` (from `progress_reported`, 0..1 or 0..100) drives a percent +
 *     a segment bar. The percent animates with the spring number ticker.
 *
 * When neither is present the caller shows its shimmer thinking indicator
 * instead — this component renders nothing in that case. Respects
 * `prefers-reduced-motion` (no bar transition, static shimmer).
 */
export function StreamingStatusLine({
  status,
  progress,
}: {
  status?: string | null;
  progress?: number | null;
}) {
  const reduce = useReducedMotion();
  const hasStatus = !!status && status.trim().length > 0;
  const hasProgress = progress !== null && progress !== undefined;
  if (!hasStatus && !hasProgress) return null;

  // Normalise 0..1 fractions to a 0..100 percent; clamp defensively.
  const percent = hasProgress
    ? Math.max(0, Math.min(100, progress! <= 1 ? progress! * 100 : progress!))
    : 0;

  const shimmerCss = reduce
    ? { ...thinkingShimmerStyles, animation: "none" }
    : thinkingShimmerStyles;

  return (
    <VStack align="stretch" gap={2} alignSelf="stretch">
      {hasStatus ? (
        <HStack gap={2} align="center">
          <SparkleTile size={22} sparkleSize={11} />
          <Box
            textStyle="xs"
            fontWeight="500"
            letterSpacing="-0.005em"
            css={shimmerCss}
            role="status"
            aria-live="polite"
          >
            {status}
          </Box>
        </HStack>
      ) : null}

      {hasProgress ? (
        <VStack align="stretch" gap={1}>
          <HStack justify="space-between">
            <Text textStyle="2xs" color="fg.muted">
              Working
            </Text>
            <Text textStyle="2xs" color="fg.muted" fontVariantNumeric="tabular-nums">
              <NumberTicker
                value={Math.round(percent)}
                format={(n) => `${n}%`}
              />
            </Text>
          </HStack>
          <Box
            height="4px"
            borderRadius="full"
            background="bg.muted"
            overflow="hidden"
          >
            <MotionBox
              height="full"
              borderRadius="full"
              background="orange.solid"
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 120, damping: 24 }
              }
            />
          </Box>
        </VStack>
      ) : null}
    </VStack>
  );
}
