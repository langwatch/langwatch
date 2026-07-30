import { useEffect, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const TYPING_MS = 70;
const ERASING_MS = 40;
const HOLD_MS = 2600;

/**
 * Cycle through `examples`, typing each one out, holding, then erasing — used
 * as an AI composer placeholder while idle. Returns the first example with no
 * animation under reduced-motion.
 *
 * Shared by AiPromptInput and LangySidebar; keep it here (next to
 * useCyclingVerb) rather than copy-pasting the timing logic into each surface.
 */
export function useTypewriterPlaceholder(
  active: boolean,
  examples: readonly string[],
): string {
  const reduceMotion = useReducedMotion();
  const [text, setText] = useState(examples[0] ?? "");

  useEffect(() => {
    if (!active || reduceMotion) {
      setText(examples[0] ?? "");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let index = 0;
    let charIndex = (examples[0] ?? "").length;
    let phase: "type" | "hold" | "erase" = "hold";

    const tick = () => {
      if (cancelled) return;
      const word = examples[index] ?? "";

      if (phase === "type") {
        charIndex++;
        setText(word.slice(0, charIndex));
        if (charIndex >= word.length) {
          phase = "hold";
          timer = setTimeout(tick, HOLD_MS);
        } else {
          timer = setTimeout(tick, TYPING_MS);
        }
        return;
      }

      if (phase === "hold") {
        phase = "erase";
        timer = setTimeout(tick, ERASING_MS);
        return;
      }

      charIndex--;
      setText(word.slice(0, Math.max(charIndex, 0)));
      if (charIndex <= 0) {
        index = (index + 1) % examples.length;
        charIndex = 0;
        phase = "type";
      }
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
