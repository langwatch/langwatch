import { useEffect } from "react";

/**
 * Arrow keys and vim keys walk the tape; `e` opens the event detail. Bound to
 * the window so the reader never has to focus the timeline first.
 */
export function useDejaViewKeyboard({
  active,
  eventCount,
  eventCursor,
  onSelectEvent,
  onToggleEventDetail,
}: {
  active: boolean;
  eventCount: number;
  eventCursor: number;
  onSelectEvent: (index: number) => void;
  onToggleEventDetail: () => void;
}) {
  useEffect(() => {
    if (!active || eventCount === 0) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (event.key) {
        case "ArrowLeft":
        case "h":
          event.preventDefault();
          onSelectEvent(Math.max(0, eventCursor - 1));
          break;
        case "ArrowRight":
        case "l":
          event.preventDefault();
          onSelectEvent(Math.min(eventCount - 1, eventCursor + 1));
          break;
        case "e":
          event.preventDefault();
          onToggleEventDetail();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, eventCount, eventCursor, onSelectEvent, onToggleEventDetail]);
}
