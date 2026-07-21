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

// Truncation is load-bearing, not decorative: in the panel header the title
// shares a row with the controls, so it MUST clip rather than push them off the
// panel's edge. The letters animate with opacity + blur only (never `transform`,
// which does not apply to inline elements) so each letter can stay INLINE text —
// which is the one arrangement `text-overflow: ellipsis` actually truncates.
// Split into atomic `inline-block` letters (the old cut) and the browser clips
// with no ellipsis at all.
const TRUNCATE = {
  display: "block",
  maxWidth: "100%",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
} as const;

/**
 * A conversation title that transitions like magic when it changes: the old
 * text blurs and fades out, then the new text is re-written character by
 * character with a blur-to-clear reveal. Used in the panel header and the
 * recent-chats list so an auto-generated title visibly replaces the
 * first-message placeholder.
 *
 * It TRUNCATES with an ellipsis and never grows its container: a long generated
 * title clips instead of shoving the header's controls off-screen, and the full
 * text stays available as a native tooltip. The FIRST render shows the title
 * instantly (no reveal) — only a genuine change animates. `prefers-reduced-motion`
 * users get plain, static, still-truncating text.
 */
export function AnimatedConversationTitle({ title }: { title: string }) {
  const reduce = useReducedMotion();
  const letters = useMemo(() => Array.from(title), [title]);

  if (reduce) {
    return (
      <chakra.span title={title} css={TRUNCATE}>
        {title}
      </chakra.span>
    );
  }

  return (
    // The block wrapper owns the truncation + the full-text tooltip; the inline
    // letters inside are what the ellipsis actually clips.
    // `mode="wait"` so the old title fully clears before the new one writes in;
    // `initial={false}` so the title already present on mount doesn't animate.
    <chakra.span title={title} css={TRUNCATE}>
      <AnimatePresence mode="wait" initial={false}>
        <MotionSpan
          key={title}
          display="inline"
          exit={{ opacity: 0, filter: "blur(4px)" }}
          transition={FADE_OUT}
        >
          {letters.map((char, index) => (
            <MotionSpan
              key={index}
              display="inline"
              whiteSpace="pre"
              initial={{ opacity: 0, filter: "blur(5px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
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
    </chakra.span>
  );
}
