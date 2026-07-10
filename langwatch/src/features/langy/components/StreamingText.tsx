import { chakra } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const MotionSpan = motion.create(chakra.span);

// Blur-to-clear word reveal tuning. Spring, <=500ms settle, ~60ms stagger.
const WORD_STAGGER_S = 0.06;
const MAX_BATCH_DELAY_S = 0.3;
const REVEAL_SPRING = {
  type: "spring" as const,
  stiffness: 320,
  damping: 30,
  mass: 0.7,
};

/**
 * Streams the live turn's tokens with a blur-to-clear WORD reveal: each newly
 * arrived word transitions from blurred to sharp with a slight upward drift,
 * on a spring, staggered ~60ms across words that land in the same batch. Only
 * NEW words animate — previously settled words never re-animate as the text
 * grows (append-only streaming), because their motion element stays mounted.
 *
 * Respects `prefers-reduced-motion`: reduced-motion users get the plain text
 * with no blur/drift.
 */
export function StreamingText({ text }: { text: string }) {
  const reduce = useReducedMotion();

  // Split into words, preserving trailing whitespace so spacing survives.
  const words = useMemo(() => splitWords(text), [text]);

  // Words with index >= batchStart are new THIS render → they animate with a
  // small positional stagger; already-settled words render with no delay
  // (their initial/animate ran once on mount and won't re-run).
  const settledCountRef = useRef(0);
  const batchStart = settledCountRef.current;
  useEffect(() => {
    settledCountRef.current = words.length;
  }, [words.length]);

  if (reduce) {
    return <chakra.span>{text}</chakra.span>;
  }

  return (
    <chakra.span>
      {words.map((word, index) => {
        const isNew = index >= batchStart;
        const delay = isNew
          ? Math.min((index - batchStart) * WORD_STAGGER_S, MAX_BATCH_DELAY_S)
          : 0;
        return (
          <MotionSpan
            key={index}
            display="inline-block"
            whiteSpace="pre"
            initial={{ opacity: 0, filter: "blur(6px)", y: 4 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            transition={{ ...REVEAL_SPRING, delay }}
          >
            {word}
          </MotionSpan>
        );
      })}
    </chakra.span>
  );
}

/**
 * Split text into word segments, each carrying its trailing whitespace so
 * `inline-block` spans don't collapse spacing. Append-only, so index keys are
 * stable across streamed growth.
 */
function splitWords(text: string): string[] {
  const matches = text.match(/\S+\s*|\s+/g);
  return matches ?? [];
}
