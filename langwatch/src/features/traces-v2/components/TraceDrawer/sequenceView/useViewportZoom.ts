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
 * State + handlers for the pannable / pinch-zoomable SVG canvas. Owns the
 * `view` (translate + zoom), viewport + svg size tracking, fit-to-screen
 * computation, animated transitions, wheel pinch/pan, drag-to-pan, and the
 * minimap rectangle math.
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
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const computeFit = useCallback((): View | null => {
    const size = svgSizeRef.current;
    const vp = viewportSizeRef.current;
    if (!size || !vp.width || !vp.height) return null;
    const sx = (vp.width - FIT_PADDING * 2) / size.width;
    const sy = (vp.height - FIT_PADDING * 2) / size.height;
    const z = clampZoom(Math.min(sx, sy, 1.5));
    return {
      z,
      x: (vp.width - size.width * z) / 2,
      y: (vp.height - size.height * z) / 2,
    };
  }, []);

  const animateTo = useCallback(
    (target: View) => {
      cancelAnimation();
      const from = viewRef.current;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / ZOOM_ANIMATION_MS);
        const e = 1 - Math.pow(1 - t, 3);
        setView({
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          z: from.z + (target.z - from.z) * e,
        });
        if (t < 1) animationRef.current = requestAnimationFrame(tick);
        else animationRef.current = null;
      };
      animationRef.current = requestAnimationFrame(tick);
    },
    [cancelAnimation],
  );

  const fit = useCallback(
    (animate = false) => {
      const target = computeFit();
      if (!target) return;
      if (animate) animateTo(target);
      else setView(target);
    },
    [computeFit, animateTo],
  );

  // Auto-fit on fresh diagram or viewport resize.
  useEffect(() => {
    if (!svgSize || !viewportSize.width || !viewportSize.height) return;
    fit(false);
  }, [svgSize, viewportSize.width, viewportSize.height, fit]);

  // Wheel: pinch (ctrl/meta) zooms toward cursor; otherwise pan.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      cancelAnimation();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const ax = e.clientX - rect.left;
        const ay = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * PINCH_SENSITIVITY);
        const v = viewRef.current;
        const next = clampZoom(v.z * factor);
        if (next === v.z) return;
        setView({
          z: next,
          x: ax - ((ax - v.x) * next) / v.z,
          y: ay - ((ay - v.y) * next) / v.z,
        });
        return;
      }
      e.preventDefault();
      const v = viewRef.current;
      setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [cancelAnimation]);

  // Drag-to-pan; actors get clicks on no-drag.
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
        if (!dragged && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
          dragged = true;
          isPanningRef.current = true;
          document.body.style.cursor = "grabbing";
        }
        if (!dragged) return;
        setView({
          ...startView,
          x: startView.x + dx,
          y: startView.y + dy,
        });
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
    },
    [cancelAnimation],
  );

  // Double-click: zoom in 2× at cursor, or fit if already zoomed in.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ax = e.clientX - rect.left;
      const ay = e.clientY - rect.top;
      const v = viewRef.current;
      if (v.z >= 1.6) {
        const fitTarget = computeFit();
        if (fitTarget) animateTo(fitTarget);
        return;
      }
      const next = clampZoom(v.z * 2);
      animateTo({
        z: next,
        x: ax - ((ax - v.x) * next) / v.z,
        y: ay - ((ay - v.y) * next) / v.z,
      });
    },
    [animateTo, computeFit],
  );

  const handleZoomBtn = useCallback(
    (factor: number) => {
      const v = viewRef.current;
      const next = clampZoom(v.z * factor);
      if (next === v.z) return;
      const cx = viewportSizeRef.current.width / 2;
      const cy = viewportSizeRef.current.height / 2;
      animateTo({
        z: next,
        x: cx - ((cx - v.x) * next) / v.z,
        y: cy - ((cy - v.y) * next) / v.z,
      });
    },
    [animateTo],
  );

  const handleResetFit = useCallback(() => {
    const target = computeFit();
    if (target) animateTo(target);
  }, [computeFit, animateTo]);

  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const size = svgSizeRef.current;
      const vp = viewportSizeRef.current;
      if (!size || !vp.width) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = Math.min(MINIMAP_W / size.width, MINIMAP_H / size.height);
      const ox = (MINIMAP_W - size.width * scale) / 2;
      const oy = (MINIMAP_H - size.height * scale) / 2;
      const cx = e.clientX - rect.left - ox;
      const cy = e.clientY - rect.top - oy;
      const svgX = cx / scale;
      const svgY = cy / scale;
      const v = viewRef.current;
      animateTo({
        z: v.z,
        x: vp.width / 2 - svgX * v.z,
        y: vp.height / 2 - svgY * v.z,
      });
    },
    [animateTo],
  );

  const minimapRect = useMemo(() => {
    if (!svgSize || !viewportSize.width) return null;
    const scale = Math.min(
      MINIMAP_W / svgSize.width,
      MINIMAP_H / svgSize.height,
    );
    const ox = (MINIMAP_W - svgSize.width * scale) / 2;
    const oy = (MINIMAP_H - svgSize.height * scale) / 2;
    return {
      x: (-view.x / view.z) * scale + ox,
      y: (-view.y / view.z) * scale + oy,
      w: (viewportSize.width / view.z) * scale,
      h: (viewportSize.height / view.z) * scale,
    };
  }, [svgSize, viewportSize.width, viewportSize.height, view]);

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
