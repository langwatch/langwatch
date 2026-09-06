import { Box, HStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { langyThinkingShimmerStyles } from "./langyShimmer";

const MotionText = motion.create(Box);

/**
 * The calm line Langy shows while it is RECOVERING a failed turn — a deploy
 * interrupted it, the manager was busy, the connection dropped — and is about
 * to re-drive the turn on its own.
 *
 * Deliberately the SAME visual language as the thinking indicator (13px,
 * shimmering, no avatar, no chrome): recovering is Langy still working, not
 * Langy failing. A red card here would tell the user something is broken and
 * ask them to act, when nothing is broken and they need do nothing. The card is
 * held back until the recovery policy has actually run out of attempts.
 *
 * Reduced motion: drop the sweep, keep the static gradient and the text swap.
 */
export function LangyRecoveringLine({ message }: { message: string }) {
  const reduceMotion = useReducedMotion();
  const shimmerCss = reduceMotion
    ? { ...langyThinkingShimmerStyles, animation: "none" }
    : langyThinkingShimmerStyles;

  return (
    <HStack gap={2.5} alignSelf="flex-start" paddingY={0.5} paddingLeft={0.5}>
      <Box
        position="relative"
        minHeight="1.5em"
        display="flex"
        alignItems="center"
      >
        {/* `mode="wait"` + a text key: the at-capacity countdown re-renders once
            a second, and a crossfade per tick would strobe. Keying on the whole
            line means the tick swaps in with the same blur-reveal every other
            status line in the panel uses. */}
        <AnimatePresence mode="wait" initial={false}>
          <MotionText
            key={message}
            role="status"
            aria-live="polite"
            fontSize="sm"
            fontWeight="500"
            letterSpacing="-0.005em"
            lineHeight="1.5"
            css={shimmerCss}
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
            {message}
          </MotionText>
        </AnimatePresence>
      </Box>
    </HStack>
  );
}
