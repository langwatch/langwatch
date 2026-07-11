import { chakra } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const MotionSpan = motion.create(chakra.span);

// "Magic" retitle tuning: the old title blurs away, then the new one is
// rewritten letter by letter on a quick spring stagger.
const LETTER_STAGGER_S = 0.022;
const MAX_REVEAL_DELAY_S = 0.5;
const REVEAL_SPRING = {
  type: "spring" as const,
  stiffness: 340,
  damping: 26,
  mass: 0.6,
};
const FADE_OUT = { duration: 0.18, ease: "easeIn" as const };

/**
 * A conversation title that transitions like magic when it changes: the old
 * text blurs and fades out, then the new text is re-written character by
 * character with a blur-to-clear reveal. Used in the recent-chats list so an
 * auto-generated title visibly replaces the first-message placeholder.
 *
 * The FIRST render shows the title instantly (no reveal) — only a genuine
 * change animates. `prefers-reduced-motion` users get plain, static text.
 */
export function AnimatedConversationTitle({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const letters = useMemo(() => Array.from(title), [title]);

  if (reduce) {
    return <chakra.span>{title}</chakra.span>;
  }

  return (
    // `mode="wait"` so the old title fully clears before the new one writes in;
    // `initial={false}` so the title already present on mount doesn't animate.
    <AnimatePresence mode="wait" initial={false}>
      <MotionSpan
        key={title}
        display="inline-block"
        exit={{ opacity: 0, filter: "blur(4px)" }}
        transition={FADE_OUT}
      >
        {letters.map((char, index) => (
          <MotionSpan
            key={index}
            display="inline-block"
            whiteSpace="pre"
            initial={{ opacity: 0, filter: "blur(5px)", y: 2 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            transition={{
              ...REVEAL_SPRING,
              delay: Math.min(index * LETTER_STAGGER_S, MAX_REVEAL_DELAY_S),
            }}
          >
            {char}
          </MotionSpan>
        ))}
      </MotionSpan>
    </AnimatePresence>
  );
}
