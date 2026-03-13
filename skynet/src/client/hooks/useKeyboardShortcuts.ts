import { useEffect } from "react";

interface ShortcutHandlers {
  onToggleBlocked?: () => void;
  onFocusSearch?: () => void;
  onClearFilters?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore IME composition and modifier-key combos
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") {
          target?.blur();
          handlers.onClearFilters?.();
        }
        return;
      }

      switch (e.key) {
        case "b":
          e.preventDefault();
          handlers.onToggleBlocked?.();
          break;
        case "/":
          e.preventDefault();
          handlers.onFocusSearch?.();
          break;
        case "Escape":
          handlers.onClearFilters?.();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
