import { useEffect, useState } from "react";

import { useReducedMotion } from "../../use-reduced-motion.ts";

const TYPING_MS = 70;
const ERASING_MS = 40;
const HOLD_MS = 2600;

interface TypewriterState {
  index: number;
  charIndex: number;
  phase: "type" | "hold" | "erase";
}

function typeStep(state: TypewriterState, word: string): number {
  state.charIndex++;
  if (state.charIndex < word.length) return TYPING_MS;
  state.phase = "hold";
  return HOLD_MS;
}

function eraseStep(state: TypewriterState, exampleCount: number): void {
  state.charIndex--;
  if (state.charIndex > 0) return;
  state.index = (state.index + 1) % exampleCount;
  state.charIndex = 0;
  state.phase = "type";
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
      const word = examples[state.index] ?? "";

      if (state.phase === "type") {
        const delay = typeStep(state, word);
        setText(word.slice(0, state.charIndex));
        timer = setTimeout(tick, delay);
        return;
      }

      if (state.phase === "hold") {
        state.phase = "erase";
        timer = setTimeout(tick, ERASING_MS);
        return;
      }

      eraseStep(state, examples.length);
      setText(word.slice(0, Math.max(state.charIndex, 0)));
      timer = setTimeout(tick, ERASING_MS);
    };

    timer = setTimeout(tick, HOLD_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, reduceMotion, examples]);

  return text;
}
