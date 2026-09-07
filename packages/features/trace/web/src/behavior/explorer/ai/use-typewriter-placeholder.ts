import { useEffect, useState } from "react";
import { useReducedMotion } from "../../use-reduced-motion.ts";

const TYPING_MS = 70;
const ERASING_MS = 40;
const HOLD_MS = 2600;

type TypewriterPhase = "type" | "hold" | "erase";

interface TypewriterState {
  index: number;
  charIndex: number;
  phase: TypewriterPhase;
}

/** Advances one tick of the type/hold/erase cycle, mutating `state` in place. */
function advanceTypewriter(
  state: TypewriterState,
  examples: readonly string[],
): { text: string; delay: number } {
  const word = examples[state.index] ?? "";

  if (state.phase === "type") {
    state.charIndex++;
    const text = word.slice(0, state.charIndex);
    if (state.charIndex >= word.length) {
      state.phase = "hold";
      return { text, delay: HOLD_MS };
    }
    return { text, delay: TYPING_MS };
  }

  if (state.phase === "hold") {
    state.phase = "erase";
    return { text: word, delay: ERASING_MS };
  }

  state.charIndex--;
  const text = word.slice(0, Math.max(state.charIndex, 0));
  if (state.charIndex <= 0) {
    state.index = (state.index + 1) % examples.length;
    state.charIndex = 0;
    state.phase = "type";
  }
  return { text, delay: ERASING_MS };
}

/**
 * Cycle through `examples`, typing each one out, holding, then erasing — used as an AI
 * composer placeholder while idle. Returns the first example with no animation under
 * reduced-motion.
 */
export function useTypewriterPlaceholder(active: boolean, examples: readonly string[]): string {
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState(examples[0] ?? "");

  useEffect(() => {
    if (!active || reduceMotion) {
      setText(examples[0] ?? "");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const state: TypewriterState = {
      index: 0,
      charIndex: (examples[0] ?? "").length,
      phase: "hold",
    };

    const tick = () => {
      if (cancelled) return;
      const { text: nextText, delay } = advanceTypewriter(state, examples);
      setText(nextText);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, HOLD_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, reduceMotion, examples]);

  return text;
}
