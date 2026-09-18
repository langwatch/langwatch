import { useEffect } from "react";

/**
 * Calls `onEscape` when Escape is pressed, but only while `enabled` is true.
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
