import type React from "react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;
const FIT_PADDING = 16;
const DRAG_THRESHOLD_PX = 4;
const ZOOM_ANIMATION_MS = 220;
const PINCH_SENSITIVITY = 0.01;

const MINIMAP_W = 200;
const MINIMAP_H = 72;

interface SvgSize {
  width: number;
  height: number;
}

export interface View {
  x: number;
  y: number;
  z: number;
}

const IDENTITY: View = { x: 0, y: 0, z: 1 };

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Zoom about an anchor point, so the point under it stays put. */
function zoomAround({ view, z, ax, ay }: { view: View; z: number; ax: number; ay: number }): View {
  return { z, x: ax - ((ax - view.x) * z) / view.z, y: ay - ((ay - view.y) * z) / view.z };
}

/** The view fitting the diagram, padded and centred; none before both sizes are measured. */
function fitView({ size, viewport }: { size: SvgSize | null; viewport: SvgSize }): View[] {
  if (!size || !viewport.width || !viewport.height) return [];
  const sx = (viewport.width - FIT_PADDING * 2) / size.width;
  const sy = (viewport.height - FIT_PADDING * 2) / size.height;
  const z = clampZoom(Math.min(sx, sy, 1.5));
  return [
    { z, x: (viewport.width - size.width * z) / 2, y: (viewport.height - size.height * z) / 2 },
  ];
}

/** The diagram's scale and offset inside the minimap box. */
function minimapLayout(size: SvgSize) {
  const scale = Math.min(MINIMAP_W / size.width, MINIMAP_H / size.height);
  return {
    scale,
    ox: (MINIMAP_W - size.width * scale) / 2,
    oy: (MINIMAP_H - size.height * scale) / 2,
  };
}

/** Where the viewport sits on the minimap; none before both sizes are known. */
function minimapRectOf({
  svgSize,
  viewportWidth,
  viewportHeight,
  view,
}: {
  svgSize: SvgSize | null;
  viewportWidth: number;
  viewportHeight: number;
  view: View;
}) {
  if (!svgSize || !viewportWidth) return null;
  const { scale, ox, oy } = minimapLayout(svgSize);
  return {
    x: (-view.x / view.z) * scale + ox,
    y: (-view.y / view.z) * scale + oy,
    w: (viewportWidth / view.z) * scale,
    h: (viewportHeight / view.z) * scale,
  };
}

function easedView({ from, to, t }: { from: View; to: View; t: number }): View {
  const e = 1 - Math.pow(1 - t, 3);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    z: from.z + (to.z - from.z) * e,
  };
}

/** The element's client size, kept current as it resizes. */
function useElementSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<SvgSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The view plus an eased transition to a target, cancelled on unmount. */
function useAnimatedView() {
  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;
  const animationRef = useRef<number | null>(null);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);
  // The drawer can close mid-animation; the tick must not outlive it.
  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  const animateTo = useCallback(
    (target: View) => {
      cancelAnimation();
      const from = viewRef.current;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / ZOOM_ANIMATION_MS);
        setView(easedView({ from, to: target, t }));
        animationRef.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation],
  );
  return { view, setView, viewRef, animateTo, cancelAnimation };
}

/** Wheel: a pinch (ctrl/meta) zooms toward the cursor, anything else pans. */
function useWheelZoom({
  viewportRef,
  viewRef,
  setView,
  cancelAnimation,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<View>;
  setView: Dispatch<SetStateAction<View>>;
  cancelAnimation: () => void;
}) {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      cancelAnimation();
      e.preventDefault();
      const v = viewRef.current;
      if (!(e.ctrlKey || e.metaKey)) {
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
        return;
      }
      const rect = el.getBoundingClientRect();
      const z = clampZoom(v.z * Math.exp(-e.deltaY * PINCH_SENSITIVITY));
      if (z === v.z) return;
      setView(zoomAround({ view: v, z, ax: e.clientX - rect.left, ay: e.clientY - rect.top }));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [viewportRef, viewRef, setView, cancelAnimation]);
}

/** Drag-to-pan past a small threshold; below it the press stays a click. */
function usePanDrag({
  viewRef,
  setView,
  cancelAnimation,
}: {
  viewRef: RefObject<View>;
  setView: Dispatch<SetStateAction<View>>;
  cancelAnimation: () => void;
}) {
  const isPanningRef = useRef(false);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      cancelAnimation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startView = viewRef.current;
      let dragged = false;

      const handleMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragged = true;
        isPanningRef.current = true;
        document.body.style.cursor = "grabbing";
        setView({ ...startView, x: startView.x + dx, y: startView.y + dy });
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        document.body.style.cursor = "";
        // Deferred, so the click that ends a drag still sees it was a drag.
        setTimeout(() => {
          isPanningRef.current = false;
        }, 0);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [viewRef, setView, cancelAnimation],
  );
  return { isPanningRef, handlePointerDown };
}

interface ViewportZoomReturn {
  view: View;
  viewportSize: SvgSize;
  svgSize: SvgSize | null;
  setSvgSize: Dispatch<SetStateAction<SvgSize | null>>;
  svgSizeRef: RefObject<SvgSize | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  isPanningRef: RefObject<boolean>;
  handleZoomBtn: (factor: number) => void;
  handleResetFit: () => void;
  handleMinimapClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handlePointerDown: (e: React.PointerEvent) => void;
  handleDoubleClick: (e: React.MouseEvent) => void;
  minimapRect: { x: number; y: number; w: number; h: number } | null;
  ZOOM_STEP: number;
  MINIMAP_W: number;
  MINIMAP_H: number;
}

/**
 * State + handlers for the pannable / pinch-zoomable SVG canvas: the view
 * (translate + zoom), size tracking, fit-to-screen, animated transitions, wheel
 * and drag, and the minimap rectangle.
 */
export function useViewportZoom(): ViewportZoomReturn {
  const { view, setView, viewRef, animateTo, cancelAnimation } = useAnimatedView();
  const [svgSize, setSvgSize] = useState<SvgSize | null>(null);
  const svgSizeRef = useRef<SvgSize | null>(null);
  svgSizeRef.current = svgSize;
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSize = useElementSize(viewportRef);
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  const currentFit = useCallback(
    () => fitView({ size: svgSizeRef.current, viewport: viewportSizeRef.current }),
    [],
  );

  // A fresh diagram or a resized viewport fits again.
  const { width: viewportWidth, height: viewportHeight } = viewportSize;
  useEffect(() => {
    const viewport = { width: viewportWidth, height: viewportHeight };
    for (const target of fitView({ size: svgSize, viewport })) setView(target);
  }, [svgSize, viewportWidth, viewportHeight, setView]);

  useWheelZoom({ viewportRef, viewRef, setView, cancelAnimation });
  const { isPanningRef, handlePointerDown } = usePanDrag({ viewRef, setView, cancelAnimation });

  const handleResetFit = useCallback(() => {
    for (const target of currentFit()) animateTo(target);
  }, [currentFit, animateTo]);

  // Double-click zooms in 2x at the cursor, or fits when already zoomed in.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = viewportRef.current;
      if (!el) return;
      const v = viewRef.current;
      if (v.z >= 1.6) {
        handleResetFit();
        return;
      }
      const rect = el.getBoundingClientRect();
      animateTo(
        zoomAround({
          view: v,
          z: clampZoom(v.z * 2),
          ax: e.clientX - rect.left,
          ay: e.clientY - rect.top,
        }),
      );
    },
    [animateTo, handleResetFit, viewRef],
  );

  const handleZoomBtn = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      const z = clampZoom(v.z * factor);
      if (z === v.z) return;
      const { width, height } = viewportSizeRef.current;
      animateTo(zoomAround({ view: v, z, ax: width / 2, ay: height / 2 }));
    },
    [animateTo, viewRef],
  );

  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const size = svgSizeRef.current;
      const vp = viewportSizeRef.current;
      if (!size || !vp.width) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const { scale, ox, oy } = minimapLayout(size);
      const svgX = (e.clientX - rect.left - ox) / scale;
      const svgY = (e.clientY - rect.top - oy) / scale;
      const v = viewRef.current;
      animateTo({ z: v.z, x: vp.width / 2 - svgX * v.z, y: vp.height / 2 - svgY * v.z });
    },
    [animateTo, viewRef],
  );

  const minimapRect = useMemo(
    () => minimapRectOf({ svgSize, viewportWidth, viewportHeight, view }),
    [svgSize, viewportWidth, viewportHeight, view],
  );

  return {
    view,
    viewportSize,
    svgSize,
    setSvgSize,
    svgSizeRef,
    viewportRef,
    isPanningRef,
    handleZoomBtn,
    handleResetFit,
    handleMinimapClick,
    handlePointerDown,
    handleDoubleClick,
    minimapRect,
    ZOOM_STEP,
    MINIMAP_W,
    MINIMAP_H,
  };
}
