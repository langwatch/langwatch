import { useCallback, useRef } from "react";
import { DRAG_THRESHOLD_PX } from "./constants";
import type { Viewport } from "./types";

export interface UseFlamePanDragResult {
  isPanningRef: React.MutableRefObject<boolean>;
  handlePointerDown: (e: React.PointerEvent) => void;
}

/**
 * Drag-to-pan on the flame area. Spans get click events on no-drag.
 * The `isPanningRef` flag is set during drag so span click handlers
 * can suppress their selection when a pan gesture just finished.
 */
export function useFlamePanDrag({
  flameAreaRef,
  viewportRef,
  cancelAnimation,
  clampViewport,
  setViewport,
}: {
  flameAreaRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<Viewport>;
  cancelAnimation: () => void;
  clampViewport: (v: Viewport) => Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}): UseFlamePanDragResult {
  const isPanningRef = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = flameAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const startX = e.clientX;
      const startVp = viewportRef.current;
      const dur = startVp.endMs - startVp.startMs;
      let dragged = false;
      cancelAnimation();

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (!dragged && Math.abs(dx) >= DRAG_THRESHOLD_PX) {
          dragged = true;
          isPanningRef.current = true;
          document.body.style.cursor = "grabbing";
        }
        if (!dragged) return;
        const dt = (dx / rect.width) * dur;
        setViewport(
          clampViewport({
            startMs: startVp.startMs - dt,
            endMs: startVp.endMs - dt,
          }),
        );
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        window.removeEventListener("blur", cleanup);
        document.body.style.cursor = "";
        // Defer flag reset so synchronous click handlers see we just dragged.
        setTimeout(() => {
          isPanningRef.current = false;
        }, 0);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
      window.addEventListener("blur", cleanup);
    },
    [cancelAnimation, clampViewport, flameAreaRef, setViewport, viewportRef],
  );

  return { isPanningRef, handlePointerDown };
}
