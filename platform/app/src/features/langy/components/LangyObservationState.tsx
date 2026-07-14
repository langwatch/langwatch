/** Quiet loading state for inspecting existing data rather than taking an action. */
import { Box, HStack, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const MotionBox = motion.create(Box);

/** A tiny observer with hands folded behind their back, paired with the orb. */
export function LangyObserverGlyph() {
  const reduce = useReducedMotion();
  return (
    <Box
      position="relative"
      width="18px"
      height="18px"
      flexShrink={0}
      aria-hidden
    >
      <MotionBox
        position="absolute"
        left="1px"
        top="7px"
        width="7px"
        height="7px"
        borderRadius="full"
        background="orange.solid"
        filter="blur(3px)"
        animate={
          reduce
            ? { opacity: 0.35 }
            : { opacity: [0.2, 0.65, 0.2], scale: [0.8, 1.35, 0.8] }
        }
        transition={
          reduce
            ? { duration: 0 }
            : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
        }
      />
      <Box
        position="absolute"
        left="2px"
        top="8px"
        width="4px"
        height="4px"
        borderRadius="full"
        background="orange.solid"
      />
      <svg
        viewBox="0 0 18 18"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="4.2" r="2.1" />
        <path d="M12 6.4v5.1m0-3.1 2.6 1.65M12 8.4 9.6 10m1.05 1.5-1.15 4.1m3.65-4.1 1.15 4.1" />
        <path d="M9.6 10c.35.85.95 1.25 1.85 1.25s1.55-.4 1.95-1.25" />
      </svg>
    </Box>
  );
}

export function LangyObservationState({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <HStack gap={2} align="center" role="status" aria-live="polite">
      <LangyObserverGlyph />
      <Text textStyle={compact ? "2xs" : "xs"} color="fg.muted">
        Observing the situation…
      </Text>
    </HStack>
  );
}
