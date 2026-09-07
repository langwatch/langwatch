import { useEffect } from "react";

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/** Whether `event` is the `⌘I` / `Ctrl+I` shortcut, unmodified by Alt/Shift. */
function isGlobalAiShortcutKey(event: KeyboardEvent): boolean {
  const isAccel = event.metaKey || event.ctrlKey;
  if (!isAccel) return false;
  if (event.key !== "i" && event.key !== "I") return false;
  return !event.altKey && !event.shiftKey;
}

/** Whether firing the shortcut now would hijack the OS italicise on an active text selection. */
function wouldHijackTextSelection(target: EventTarget | null): boolean {
  if (!isTextInputTarget(target)) return false;
  const sel = window.getSelection?.();
  return !!sel && sel.toString().length > 0;
}

// `⌘I` / `Ctrl+I` enters AI mode globally. `⌘K` is reserved for the
// project-wide command bar.
export function useGlobalAiShortcut(onTrigger: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!isGlobalAiShortcutKey(event)) return;
      if (wouldHijackTextSelection(event.target)) return;
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTrigger]);
}
