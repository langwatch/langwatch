import { useEffect } from "react";

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

// `⌘I` / `Ctrl+I` enters AI mode globally. `⌘K` is reserved for the
// project-wide command bar.
export function useGlobalAiShortcut(onTrigger: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isAccel = event.metaKey || event.ctrlKey;
      if (!isAccel) return;
      if (event.key !== "i" && event.key !== "I") return;
      if (event.altKey || event.shiftKey) return;
      if (isTextInputTarget(event.target)) {
        // Don't hijack OS italicise on an active selection.
        const sel = window.getSelection?.();
        if (sel && sel.toString().length > 0) return;
      }
      event.preventDefault();
      onTrigger();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onTrigger]);
}
