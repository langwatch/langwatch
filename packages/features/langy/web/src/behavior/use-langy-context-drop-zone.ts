import type { DragEvent } from "react";
import { useCallback, useState } from "react";
import {
  absorbContextTarget,
  LANGY_CONTEXT_DRAG_MIME,
  readDraggedTarget,
} from "./langy-context-target.store";

/**
 * Makes the panel a place you can drop things on.
 */
export function useLangyContextDropZone(): {
  /** A target is hovering over the panel right now — worth showing. */
  isOver: boolean;
  dropProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
} {
  const [isOver, setIsOver] = useState(false);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    // `types` is the only thing readable mid-drag — the DATA is withheld until
    // the drop, by design, so a page can't read what you're dragging over it.
    if (!event.dataTransfer.types.includes(LANGY_CONTEXT_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    // Dragging across the panel's own children fires leave-then-enter
    // constantly; only a leave that actually exits the panel counts.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsOver(false);
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    const target = readDraggedTarget(event.dataTransfer);
    setIsOver(false);
    if (!target) return;
    event.preventDefault();
    absorbContextTarget(target);
  }, []);

  return { isOver, dropProps: { onDragOver, onDragLeave, onDrop } };
}
