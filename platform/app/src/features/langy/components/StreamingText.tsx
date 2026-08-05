import { chakra } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const MotionSpan = motion.create(chakra.span);

// Blur-to-clear word reveal tuning. Spring, <=500ms settle, ~60ms stagger.
const WORD_STAGGER_S = 0.06;
const MAX_BATCH_DELAY_S = 0.3;
/**
 * A long streamed answer used to leave one Motion span alive per word. That
 * makes the active DOM and fiber tree grow with the answer, then reconciles the
 * whole thing every token batch. Keep the visible reveal, but only for the
 * recent tail; settled prose is one normal text node.
 */
const MAX_ANIMATED_WORDS = 48;
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
  const { words, firstAnimatedWord, settledText, animatedWords } = useMemo(
    () => partitionStreamingText(text),
    [text],
  );

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
    <chakra.span whiteSpace="pre-wrap">
      {settledText}
      {animatedWords.map((word, tailIndex) => {
        const index = firstAnimatedWord + tailIndex;
        // A newline run renders as PLAIN inline text, never inside the
        // animated inline-block: an inline-block's baseline is its LAST line
        // box, so a span holding "word\n" parks the word one line above the
        // rest of the sentence — multi-line prose read as scrambled.
        if (word.includes("\n")) {
          return <chakra.span key={index}>{word}</chakra.span>;
        }
        const isNew = index >= batchStart;
        const delay = isNew
          ? Math.min((index - batchStart) * WORD_STAGGER_S, MAX_BATCH_DELAY_S)
          : 0;
        return (
          <MotionSpan
            key={index}
            display="inline-block"
            whiteSpace="pre"
            initial={{ opacity: 0, filter: "blur(6px)", y: 5 }}
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
 * Split text into word segments, each carrying its trailing SAME-LINE
 * whitespace so `inline-block` spans don't collapse spacing. Whitespace runs
 * containing a newline are their own tokens — they must render outside the
 * inline-block spans (see the render above). Append-only, so index keys are
 * stable across streamed growth.
 */
function splitWords(text: string): string[] {
  const matches = text.match(/[^\S\n]*\n\s*|\S+[^\S\n]*|[^\S\n]+/g);
  return matches ?? [];
}

export function partitionStreamingText(text: string) {
  const words = splitWords(text);
  const firstAnimatedWord = Math.max(0, words.length - MAX_ANIMATED_WORDS);

  return {
    words,
    firstAnimatedWord,
    settledText: words.slice(0, firstAnimatedWord).join(""),
    animatedWords: words.slice(firstAnimatedWord),
  };
}
