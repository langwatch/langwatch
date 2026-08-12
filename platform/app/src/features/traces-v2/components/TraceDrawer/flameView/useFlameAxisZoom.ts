import { useCallback, useState } from "react";
import { DRAG_THRESHOLD_PX, MIN_VIEWPORT_MS } from "./constants";
import type { Viewport } from "./types";

export interface UseFlameAxisZoomResult {
  dragSelection: Viewport | null;
  handleTimeAxisPointerDown: (e: React.PointerEvent) => void;
}

/**
 * Drag-to-zoom on the time axis: drag horizontally to select a range,
 * release to animate-zoom into that range.
 */
export function useFlameAxisZoom({
  timeAxisRef,
  viewportRef,
  cancelAnimation,
  animateTo,
}: {
  timeAxisRef: React.RefObject<HTMLDivElement | null>;
  viewportRef: React.RefObject<Viewport>;
  cancelAnimation: () => void;
  animateTo: (target: Viewport) => void;
}): UseFlameAxisZoomResult {
  const [dragSelection, setDragSelection] = useState<Viewport | null>(null);

  const handleTimeAxisPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = timeAxisRef.current;
      if (!el) return;
      e.preventDefault();
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      const startVp = viewportRef.current;
      const startDur = startVp.endMs - startVp.startMs;
      const xToTime = (clientX: number) => {
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return startVp.startMs + x * startDur;
      };
      const startTimeMs = xToTime(e.clientX);
      const startClientX = e.clientX;
      let dragged = false;

      const handleMove = (ev: PointerEvent) => {
        const dx = Math.abs(ev.clientX - startClientX);
        if (!dragged && dx >= DRAG_THRESHOLD_PX) dragged = true;
        if (!dragged) return;
        const t = xToTime(ev.clientX);
        setDragSelection({
          startMs: Math.min(startTimeMs, t),
          endMs: Math.max(startTimeMs, t),
        });
      };

      const handleUp = (ev: PointerEvent) => {
        cleanup();
        if (!dragged) return;
        const t = xToTime(ev.clientX);
        const sel: Viewport = {
          startMs: Math.min(startTimeMs, t),
          endMs: Math.max(startTimeMs, t),
        };
        if (sel.endMs - sel.startMs >= MIN_VIEWPORT_MS) {
          animateTo(sel);
        }
      };
      const cleanup = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", cleanup);
        window.removeEventListener("blur", cleanup);
        setDragSelection(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", cleanup);
      window.addEventListener("blur", cleanup);
    },
    [animateTo, cancelAnimation, timeAxisRef, viewportRef],
  );

  return { dragSelection, handleTimeAxisPointerDown };
}
