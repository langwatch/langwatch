import { useEffect } from "react";

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
