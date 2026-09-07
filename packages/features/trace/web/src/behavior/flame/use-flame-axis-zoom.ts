import { useCallback, useState } from "react";
import { DRAG_THRESHOLD_PX, MIN_VIEWPORT_MS } from "../../model/flame/constants.ts";
import type { Viewport } from "./types.ts";

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
      beginAxisDrag({
        animateTo,
        rect: el.getBoundingClientRect(),
        setDragSelection,
        startClientX: e.clientX,
        viewport: viewportRef.current,
      });
    },
    [animateTo, cancelAnimation, timeAxisRef, viewportRef],
  );

  return { dragSelection, handleTimeAxisPointerDown };
}

/**
 * Follows one drag across the time axis: paints the selection while the pointer
 * moves and animates into it on release, once past the drag threshold.
 */
function beginAxisDrag({
  animateTo,
  rect,
  setDragSelection,
  startClientX,
  viewport,
}: {
  animateTo: (target: Viewport) => void;
  rect: DOMRect;
  setDragSelection: (selection: Viewport | null) => void;
  startClientX: number;
  viewport: Viewport;
}): void {
  const startDur = viewport.endMs - viewport.startMs;
  const xToTime = (clientX: number) => {
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewport.startMs + x * startDur;
  };
  const startTimeMs = xToTime(startClientX);
  let dragged = false;

  const selectionTo = (clientX: number): Viewport => {
    const t = xToTime(clientX);
    return { startMs: Math.min(startTimeMs, t), endMs: Math.max(startTimeMs, t) };
  };

  const handleMove = (ev: PointerEvent) => {
    const dx = Math.abs(ev.clientX - startClientX);
    if (!dragged && dx >= DRAG_THRESHOLD_PX) dragged = true;
    if (!dragged) return;
    setDragSelection(selectionTo(ev.clientX));
  };

  const handleUp = (ev: PointerEvent) => {
    cleanup();
    if (!dragged) return;
    const sel = selectionTo(ev.clientX);
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
}
