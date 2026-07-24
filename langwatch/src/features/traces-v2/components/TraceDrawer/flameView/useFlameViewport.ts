import { useCallback, useEffect, useRef, useState } from "react";
import {
  MIN_VIEWPORT_MS,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_ANIMATION_MS,
} from "./constants";
import type { Viewport } from "./types";

export interface UseFlameViewportResult {
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  viewportRef: React.RefObject<Viewport>;
  clampViewport: (v: Viewport) => Viewport;
  animateTo: (target: Viewport) => void;
  cancelAnimation: () => void;
}

/**
 * Manages the time-range viewport state for the flame view:
 * clamping, smooth animation (rAF-based ease-out cubic), and wheel-based
 * zoom/pan. Keeps a ref mirror of viewport so stale-closure-safe callbacks
 * can read the latest value without being in the dependency array.
 */
export function useFlameViewport({
  fullRange,
  flameAreaRef,
}: {
  fullRange: Viewport;
  flameAreaRef: React.RefObject<HTMLDivElement | null>;
}): UseFlameViewportResult {
  const [viewport, setViewport] = useState<Viewport>(fullRange);
  const animationRef = useRef<number | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Reset viewport when underlying spans change.
  useEffect(() => {
    setViewport(fullRange);
  }, [fullRange]);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  // Drawer can close mid-animation; without this, the rAF tick keeps firing
  // setViewport on an unmounted component.
  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  const clampViewport = useCallback(
    (v: Viewport): Viewport => {
      const fullDur = fullRange.endMs - fullRange.startMs;
      if (fullDur <= 0) return fullRange;
      const minDur = Math.min(MIN_VIEWPORT_MS, fullDur);
      const dur = Math.max(minDur, Math.min(fullDur, v.endMs - v.startMs));
      let start = v.startMs;
      let end = start + dur;
      if (start < fullRange.startMs) {
        start = fullRange.startMs;
        end = start + dur;
      }
      if (end > fullRange.endMs) {
        end = fullRange.endMs;
        start = end - dur;
      }
      return { startMs: start, endMs: end };
    },
    [fullRange],
  );

  const animateTo = useCallback(
    (target: Viewport) => {
      cancelAnimation();
      const clamped = clampViewport(target);
      const from = viewportRef.current;
      const startTime = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / ZOOM_ANIMATION_MS);
        const e = 1 - Math.pow(1 - t, 3);
        setViewport({
          startMs: from.startMs + (clamped.startMs - from.startMs) * e,
          endMs: from.endMs + (clamped.endMs - from.endMs) * e,
        });
        if (t < 1) {
          animationRef.current = requestAnimationFrame(tick);
        } else {
          animationRef.current = null;
        }
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation, clampViewport],
  );

  // Wheel: zoom toward cursor (deltaY) or pan (deltaX / shift).
  useEffect(() => {
    const el = flameAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const isPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const delta = isPan ? e.deltaX || e.deltaY : e.deltaY;
      setViewport((prev) => {
        const dur = prev.endMs - prev.startMs;
        if (isPan) {
          const dt = (delta / rect.width) * dur;
          return clampViewport({
            startMs: prev.startMs + dt,
            endMs: prev.endMs + dt,
          });
        }
        const cursorTime = prev.startMs + x * dur;
        const factor = Math.exp(delta * WHEEL_ZOOM_SENSITIVITY);
        const newDur = dur * factor;
        const newStart = cursorTime - x * newDur;
        return clampViewport({
          startMs: newStart,
          endMs: newStart + newDur,
        });
      });
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [cancelAnimation, clampViewport, flameAreaRef]);

  return {
    viewport,
    setViewport,
    viewportRef,
    clampViewport,
    animateTo,
    cancelAnimation,
  };
}
