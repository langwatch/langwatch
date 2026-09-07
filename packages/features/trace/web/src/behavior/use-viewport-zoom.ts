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

/** The view that fits `size` inside `vp` with padding, or null when either is unmeasured. */
function computeFitView(size: SvgSize | null, vp: SvgSize): View | null {
  if (!size || !vp.width || !vp.height) return null;
  const sx = (vp.width - FIT_PADDING * 2) / size.width;
  const sy = (vp.height - FIT_PADDING * 2) / size.height;
  const z = clampZoom(Math.min(sx, sy, 1.5));
  return { z, x: (vp.width - size.width * z) / 2, y: (vp.height - size.height * z) / 2 };
}

/** The minimap's viewport-rect overlay, scaled from `svgSize`/`viewportSize`/`view`. */
function computeMinimapRect(
  svgSize: SvgSize | null,
  viewportSize: SvgSize,
  view: View,
): { x: number; y: number; w: number; h: number } | null {
  if (!svgSize || !viewportSize.width) return null;
  const scale = Math.min(MINIMAP_W / svgSize.width, MINIMAP_H / svgSize.height);
  const ox = (MINIMAP_W - svgSize.width * scale) / 2;
  const oy = (MINIMAP_H - svgSize.height * scale) / 2;
  return {
    x: (-view.x / view.z) * scale + ox,
    y: (-view.y / view.z) * scale + oy,
    w: (viewportSize.width / view.z) * scale,
    h: (viewportSize.height / view.z) * scale,
  };
}

/** Builds the rAF tick that animates `view` from `from` toward `target`. */
function createViewAnimationTick({
  from,
  target,
  startTime,
  setView,
  animationRef,
}: {
  from: View;
  target: View;
  startTime: number;
  setView: Dispatch<SetStateAction<View>>;
  animationRef: React.MutableRefObject<number | null>;
}): (now: number) => void {
  const tick = (now: number) => {
    const t = Math.min(1, (now - startTime) / ZOOM_ANIMATION_MS);
    const e = 1 - Math.pow(1 - t, 3);
    setView({
      x: from.x + (target.x - from.x) * e,
      y: from.y + (target.y - from.y) * e,
      z: from.z + (target.z - from.z) * e,
    });
    if (t < 1) {
      animationRef.current = requestAnimationFrame(tick);
    } else {
      animationRef.current = null;
    }
  };
  return tick;
}

/** Starts window-level pointermove/pointerup listeners that drag-pan the view from `startView`. */
function startDragPan({
  startX,
  startY,
  startView,
  isPanningRef,
  setView,
}: {
  startX: number;
  startY: number;
  startView: View;
  isPanningRef: RefObject<boolean>;
  setView: Dispatch<SetStateAction<View>>;
}): void {
  let dragged = false;

  const handleMove = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragged && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
      dragged = true;
      isPanningRef.current = true;
      document.body.style.cursor = "grabbing";
    }
    if (!dragged) return;
    setView({ ...startView, x: startView.x + dx, y: startView.y + dy });
  };

  const handleUp = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    document.body.style.cursor = "";
    // Defer flag reset so synchronous click handlers see we just dragged.
    setTimeout(() => {
      isPanningRef.current = false;
    }, 0);
  };

  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
}

/** Double-click target: fit if already zoomed in past the threshold, else 2× at the cursor. */
function doubleClickZoomTarget({
  ax,
  ay,
  v,
  computeFit,
}: {
  ax: number;
  ay: number;
  v: View;
  computeFit: () => View | null;
}): View | null {
  if (v.z >= 1.6) return computeFit();
  const next = clampZoom(v.z * 2);
  return { z: next, x: ax - ((ax - v.x) * next) / v.z, y: ay - ((ay - v.y) * next) / v.z };
}

/** Zoom-button target: `factor` applied around the viewport center, or null if unchanged. */
function zoomBtnTarget({
  factor,
  v,
  centerX,
  centerY,
}: {
  factor: number;
  v: View;
  centerX: number;
  centerY: number;
}): View | null {
  const next = clampZoom(v.z * factor);
  if (next === v.z) return null;
  return {
    z: next,
    x: centerX - ((centerX - v.x) * next) / v.z,
    y: centerY - ((centerY - v.y) * next) / v.z,
  };
}

/** Minimap-click target: re-centers the view on the point in the diagram the click maps to. */
function minimapClickTarget({
  e,
  rect,
  size,
  vp,
  v,
}: {
  e: React.MouseEvent<HTMLDivElement>;
  rect: DOMRect;
  size: SvgSize;
  vp: SvgSize;
  v: View;
}): View {
  const scale = Math.min(MINIMAP_W / size.width, MINIMAP_H / size.height);
  const ox = (MINIMAP_W - size.width * scale) / 2;
  const oy = (MINIMAP_H - size.height * scale) / 2;
  const cx = e.clientX - rect.left - ox;
  const cy = e.clientY - rect.top - oy;
  const svgX = cx / scale;
  const svgY = cy / scale;
  return { z: v.z, x: vp.width / 2 - svgX * v.z, y: vp.height / 2 - svgY * v.z };
}

/** Tracks `el`'s content box into `setViewportSize`, or a no-op cleanup when `el` is unset. */
function subscribeViewportSize(
  el: HTMLDivElement | null,
  setViewportSize: Dispatch<SetStateAction<SvgSize>>,
): () => void {
  if (!el) return () => {};
  const update = () => setViewportSize({ width: el.clientWidth, height: el.clientHeight });
  update();
  const observer = new ResizeObserver(update);
  observer.observe(el);
  return () => observer.disconnect();
}

/** Wires the wheel-to-pan/zoom handler onto `el`, or a no-op cleanup when `el` is unset. */
function subscribeWheelPan({
  el,
  cancelAnimation,
  viewRef,
  setView,
}: {
  el: HTMLDivElement | null;
  cancelAnimation: () => void;
  viewRef: React.MutableRefObject<View>;
  setView: Dispatch<SetStateAction<View>>;
}): () => void {
  if (!el) return () => {};
  const handler = (e: WheelEvent) => {
    cancelAnimation();
    e.preventDefault();
    const next = wheelZoomOrPan({ e, rect: el.getBoundingClientRect(), v: viewRef.current });
    if (next) setView(next);
  };
  el.addEventListener("wheel", handler, { passive: false });
  return () => el.removeEventListener("wheel", handler);
}

/** Applies the fit view (computed on demand), animated or immediate. */
function applyFit({
  animate,
  computeFit,
  animateTo,
  setView,
}: {
  animate: boolean;
  computeFit: () => View | null;
  animateTo: (target: View) => void;
  setView: Dispatch<SetStateAction<View>>;
}): void {
  const target = computeFit();
  if (!target) return;
  if (animate) {
    animateTo(target);
  } else {
    setView(target);
  }
}

/** Animates to the fit view, if one can be computed. */
function resetToFit(computeFit: () => View | null, animateTo: (target: View) => void): void {
  const target = computeFit();
  if (target) animateTo(target);
}

/** Cancels a pending view animation frame, if any. */
function cancelViewAnimation(animationRef: React.MutableRefObject<number | null>): void {
  if (animationRef.current !== null) {
    cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }
}

/** Computes the next view for one wheel tick: ctrl/meta pinch-zoom toward the cursor, else pan. */
function wheelZoomOrPan({ e, rect, v }: { e: WheelEvent; rect: DOMRect; v: View }): View | null {
  if (e.ctrlKey || e.metaKey) {
    const ax = e.clientX - rect.left;
    const ay = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * PINCH_SENSITIVITY);
    const next = clampZoom(v.z * factor);
    if (next === v.z) return null;
    return { z: next, x: ax - ((ax - v.x) * next) / v.z, y: ay - ((ay - v.y) * next) / v.z };
  }
  return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
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
 * State + handlers for the pannable / pinch-zoomable SVG canvas. Owns the `view`
 * (translate + zoom), viewport + svg size tracking, fit-to-screen computation, animated
 * transitions, wheel pinch/pan, drag-to-pan, and the minimap rectangle math.
 */
export function useViewportZoom(): ViewportZoomReturn {
  const [view, setView] = useState<View>(IDENTITY);
  const viewRef = useRef(view);
  viewRef.current = view;

  const [svgSize, setSvgSize] = useState<SvgSize | null>(null);
  const svgSizeRef = useRef<SvgSize | null>(null);
  svgSizeRef.current = svgSize;

  const [viewportSize, setViewportSize] = useState<SvgSize>({
    width: 0,
    height: 0,
  });
  const viewportSizeRef = useRef(viewportSize);
  viewportSizeRef.current = viewportSize;

  const viewportRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const isPanningRef = useRef(false);

  // Track viewport size — needed for fit + minimap math.
  useLayoutEffect(() => subscribeViewportSize(viewportRef.current, setViewportSize), []);

  const cancelAnimation = useCallback(() => cancelViewAnimation(animationRef), []);

  // Drawer can close mid-animation; without this, the rAF tick keeps firing
  // setView on an unmounted component.
  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  const computeFit = useCallback((): View | null => {
    return computeFitView(svgSizeRef.current, viewportSizeRef.current);
  }, []);

  const animateTo = useCallback(
    (target: View) => {
      cancelAnimation();
      const tick = createViewAnimationTick({
        from: viewRef.current,
        target,
        startTime: performance.now(),
        setView,
        animationRef,
      });
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation],
  );

  const fit = useCallback(
    (animate = false) => applyFit({ animate, computeFit, animateTo, setView }),
    [computeFit, animateTo],
  );

  // Auto-fit on fresh diagram or viewport resize.
  useEffect(() => {
    const isMeasured = svgSize && viewportSize.width && viewportSize.height;
    if (isMeasured) fit(false);
  }, [svgSize, viewportSize.width, viewportSize.height, fit]);

  // Wheel: pinch (ctrl/meta) zooms toward cursor; otherwise pan.
  useEffect(
    () => subscribeWheelPan({ el: viewportRef.current, cancelAnimation, viewRef, setView }),
    [cancelAnimation],
  );

  // Drag-to-pan; actors get clicks on no-drag.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) {
        return;
      }
      cancelAnimation();
      startDragPan({
        startX: e.clientX,
        startY: e.clientY,
        startView: viewRef.current,
        isPanningRef,
        setView,
      });
    },
    [cancelAnimation],
  );

  // Double-click: zoom in 2× at cursor, or fit if already zoomed in.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = viewportRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      const target = doubleClickZoomTarget({
        ax: e.clientX - rect.left,
        ay: e.clientY - rect.top,
        v: viewRef.current,
        computeFit,
      });
      if (target) animateTo(target);
    },
    [animateTo, computeFit],
  );

  const handleZoomBtn = useCallback(
    (factor: number) => {
      const target = zoomBtnTarget({
        factor,
        v: viewRef.current,
        centerX: viewportSizeRef.current.width / 2,
        centerY: viewportSizeRef.current.height / 2,
      });
      if (target) animateTo(target);
    },
    [animateTo],
  );

  const handleResetFit = useCallback(
    () => resetToFit(computeFit, animateTo),
    [computeFit, animateTo],
  );

  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const size = svgSizeRef.current;
      const vp = viewportSizeRef.current;
      if (!size || !vp.width) {
        return;
      }
      animateTo(
        minimapClickTarget({
          e,
          rect: e.currentTarget.getBoundingClientRect(),
          size,
          vp,
          v: viewRef.current,
        }),
      );
    },
    [animateTo],
  );

  const minimapRect = useMemo(
    () => computeMinimapRect(svgSize, viewportSize, view),
    [svgSize, viewportSize, view],
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
