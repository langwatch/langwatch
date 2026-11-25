import { useEffect } from "react";

/**
 * Calls `onEscape` when Escape is pressed, but only while `enabled` is true.
 * An overlay that ignores it keeps swallowing pointer events behind its
 * backdrop until the reader clicks it directly — worse than unresponsive.
 */
export function useEscapeKey({
  enabled,
  onEscape,
}: {
  enabled: boolean;
  onEscape: () => void;
}): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscape();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onEscape]);
}
