import { type RefObject, useCallback, useEffect, useRef } from "react";

import {
  type CanvasColors,
  createNotFoundRenderer,
  type GridParams,
  MAX_CANVAS_DPR,
} from "../model/not-found-canvas-renderer.ts";

type Point = { x: number; y: number };

/** Sizes the canvas to its container at the capped device pixel ratio; answers the CSS size. */
function sizeCanvas(canvas: HTMLCanvasElement, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
  const w = rect.width;
  const h = rect.height;
  const pixelWidth = Math.round(w * dpr);
  const pixelHeight = Math.round(h * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  return { w, h, dpr };
}

/** Shifts the two aberration layers of the 404 against the eased pointer. */
function offsetGlitchText({
  red,
  blue,
  pointer,
}: {
  red: HTMLDivElement | null;
  blue: HTMLDivElement | null;
  pointer: Point;
}) {
  const textDx = pointer.x * 3;
  const textDy = pointer.y * 1.5;
  if (red) red.style.transform = `translate(${-2 - textDx}px, ${-1 - textDy}px)`;
  if (blue) blue.style.transform = `translate(${2 + textDx}px, ${1 + textDy}px)`;
}

/**
 * Runs `frame` on every animation frame while the tab is shown and `container` is on screen,
 * resuming when either comes back; answers the function that stops it.
 */
function animate({
  container,
  frame,
}: {
  container: HTMLElement;
  frame: (timestamp: number) => void;
}): () => void {
  let raf = 0;
  let isVisible = true;
  let isTabActive = true;

  const loop = (timestamp: number) => {
    raf = 0;
    if (!isVisible || !isTabActive) return;
    frame(timestamp);
    raf = requestAnimationFrame(loop);
  };
  const resume = () => {
    if (raf === 0) raf = requestAnimationFrame(loop);
  };

  const onVisibilityChange = () => {
    isTabActive = !document.hidden;
    if (!document.hidden) resume();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const observer = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry?.isIntersecting ?? true;
      if (entry?.isIntersecting) resume();
    },
    { threshold: 0 },
  );
  observer.observe(container);

  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observer.disconnect();
  };
}

/**
 * Draws the 404 grid on the canvas and animates it against the pointer: one static frame under
 * reduced motion, otherwise a loop that pauses while the tab is hidden or the scene is off screen.
 */
export function useNotFoundCanvas({
  canvasRef,
  containerRef,
  redTextRef,
  blueTextRef,
  paramsRef,
  colors,
  prefersReducedMotion,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  redTextRef: RefObject<HTMLDivElement | null>;
  blueTextRef: RefObject<HTMLDivElement | null>;
  paramsRef: RefObject<GridParams>;
  colors: CanvasColors;
  prefersReducedMotion: boolean;
}): void {
  const mouse = useRef<Point>({ x: 0, y: 0 });
  const smoothMouse = useRef<Point>({ x: 0, y: 0 });
  const rendererRef = useRef(createNotFoundRenderer());

  const onMove = useCallback(
    (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      mouse.current.x = Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5));
      mouse.current.y = Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5));
    },
    [containerRef],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !container || !ctx) return;

    container.addEventListener("mousemove", onMove);
    const render = rendererRef.current;
    const draw = (timestamp: number, pointer: Point) => {
      const { w, h, dpr } = sizeCanvas(canvas, container);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render({
        ctx,
        width: w,
        height: h,
        timestamp,
        params: paramsRef.current,
        colors,
        smoothMouse: pointer,
      });
    };

    // Reduced motion: render a single static frame, no animation loop
    if (prefersReducedMotion) {
      draw(0, { x: 0, y: 0 });
      return () => container.removeEventListener("mousemove", onMove);
    }

    const stop = animate({
      container,
      frame: (timestamp) => {
        smoothMouse.current.x += (mouse.current.x - smoothMouse.current.x) * 0.06;
        smoothMouse.current.y += (mouse.current.y - smoothMouse.current.y) * 0.06;
        offsetGlitchText({
          red: redTextRef.current,
          blue: blueTextRef.current,
          pointer: smoothMouse.current,
        });
        draw(timestamp, smoothMouse.current);
      },
    });
    return () => {
      stop();
      container.removeEventListener("mousemove", onMove);
    };
  }, [
    canvasRef,
    containerRef,
    redTextRef,
    blueTextRef,
    paramsRef,
    onMove,
    colors,
    prefersReducedMotion,
  ]);
}
