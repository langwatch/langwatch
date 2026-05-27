import { useEffect, useState } from "react";

import { useReducedMotion } from "~/hooks/useReducedMotion";

const TYPEWRITER_TYPING_MS = 70;
const TYPEWRITER_ERASING_MS = 40;
const TYPEWRITER_HOLD_MS = 2600;

/**
 * Cycle through `examples`, typing each one, holding, then erasing — used
 * as the composer placeholder when idle. Returns to the first example
 * (no animation) under reduced-motion. Mirrors AiPromptInput's local
 * implementation; copied inline to avoid forcing an export from a file
 * that's otherwise unrelated to Langy.
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
          timer = setTimeout(tick, TYPEWRITER_HOLD_MS);
        } else {
          timer = setTimeout(tick, TYPEWRITER_TYPING_MS);
        }
        return;
      }
      if (phase === "hold") {
        phase = "erase";
        timer = setTimeout(tick, TYPEWRITER_ERASING_MS);
        return;
      }
      charIndex--;
      setText(word.slice(0, Math.max(charIndex, 0)));
      if (charIndex <= 0) {
        index = (index + 1) % examples.length;
        charIndex = 0;
        phase = "type";
      }
      timer = setTimeout(tick, TYPEWRITER_ERASING_MS);
    };

    timer = setTimeout(tick, TYPEWRITER_HOLD_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, reduceMotion, examples]);

  return text;
}

/**
 * `⌘I` / `Ctrl+I` toggles the Langy panel globally. Mirrors
 * useGlobalAiShortcut from traces-v2. preventDefault claims it for the page
 * when keyboard focus is inside the document. If a text input is active
 * with a non-empty selection we bail to avoid hijacking OS shortcuts
 * users might be relying on (e.g. select-line).
 */
export function useGlobalLangyShortcut(onTrigger: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isAccel = event.metaKey || event.ctrlKey;
      if (!isAccel) return;
      if (event.key !== "i" && event.key !== "I") return;
      if (event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isTextInput =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (isTextInput) {
          const sel = window.getSelection?.();
          if (sel && sel.toString().length > 0) return;
        }
      }
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTrigger]);
}
