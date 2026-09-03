import { useEffect } from "react";

/**
 * Calls `onEscape` when Escape is pressed, but only while `enabled` is true.
 *
 * For overlays that dismiss on an outside click. Escape is what a reader
 * reaches for first, and an overlay backed by a full-viewport backdrop that
 * ignores it is worse than merely unresponsive: the backdrop keeps swallowing
 * pointer events, so everything behind it stays dead until the reader happens
 * to click the backdrop itself.
 *
 * The listener exists only while the overlay is open and is removed on
 * unmount, so a table full of collapsed cells registers nothing.
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
