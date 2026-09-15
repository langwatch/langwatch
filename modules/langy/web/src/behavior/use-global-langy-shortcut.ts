import { useEffect } from "react";

/**
 * `⌘I` / `Ctrl+I` toggles the Langy panel globally. Mirrors useGlobalAiShortcut from
 * traces-v2. preventDefault claims it for the page when keyboard focus is inside the
 * document.
 */
/** `⌘I` / `Ctrl+I`, with no modifier riders. */
function isShortcutKey(event: KeyboardEvent): boolean {
  const isAccel = event.metaKey || event.ctrlKey;
  return isAccel && (event.key === "i" || event.key === "I") && !event.altKey && !event.shiftKey;
}

/** A text field with an active selection is claiming the key for itself. */
function hasActiveTextSelection(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const isTextInput =
    target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  if (!isTextInput) return false;
  const sel = window.getSelection?.();
  return Boolean(sel && sel.toString().length > 0);
}

export function useGlobalLangyShortcut(onTrigger: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isShortcutKey(event)) return;
      if (hasActiveTextSelection(event.target)) return;
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTrigger]);
}
