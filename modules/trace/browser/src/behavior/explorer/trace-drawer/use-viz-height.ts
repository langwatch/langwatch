import {
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const VIZ_MIN_HEIGHT = 80;
const VIZ_DEFAULT_HEIGHT = 250;
const VIZ_EXPANDED_HEIGHT = 480;
const VIZ_MAX_HEIGHT = 700;
const STORAGE_KEY = "langwatch:traces-v2:viz-height";

/** The stored height when it is one the panel can take: zero (minimised) or within range. */
function readStoredHeight(stored: string | null): number {
  const parsed = stored ? parseInt(stored, 10) : NaN;
  if (parsed === 0) return 0;
  if (parsed >= VIZ_MIN_HEIGHT && parsed <= VIZ_MAX_HEIGHT) return parsed;
  return VIZ_DEFAULT_HEIGHT;
}

function storedHeight(): number {
  if (typeof window === "undefined") return VIZ_DEFAULT_HEIGHT;
  return readStoredHeight(localStorage.getItem(STORAGE_KEY));
}

function persistHeight(height: number) {
  localStorage.setItem(STORAGE_KEY, String(height));
}

/** Minimised opens to default, default expands, expanded minimises. */
function cycledHeight(previous: number): number {
  if (previous === 0) return VIZ_DEFAULT_HEIGHT;
  return previous < VIZ_EXPANDED_HEIGHT ? VIZ_EXPANDED_HEIGHT : 0;
}

/** A dragged height, snapping shut below half the minimum. */
function draggedHeight(raw: number): number {
  if (raw < VIZ_MIN_HEIGHT / 2) return 0;
  return Math.min(VIZ_MAX_HEIGHT, Math.max(VIZ_MIN_HEIGHT, raw));
}

function clientYOf(e: MouseEvent | TouchEvent | ReactMouseEvent | ReactTouchEvent): number {
  return "touches" in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;
}

/**
 * The stand-alone viz panel's height: remembered across renders, cycled by the
 * size button, dragged by the handle. In fill-parent mode the parent pane owns
 * sizing, so nothing here is touched or persisted.
 */
export function useVizHeight({ fillParent, hasData }: { fillParent: boolean; hasData: boolean }) {
  const [height, setHeight] = useState(storedHeight);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  const isMinimized = !fillParent && height === 0;
  const isCollapsed = !fillParent && !isMinimized && height <= VIZ_MIN_HEIGHT + 20;

  const restoreDefault = useCallback(() => {
    setHeight(VIZ_DEFAULT_HEIGHT);
    persistHeight(VIZ_DEFAULT_HEIGHT);
  }, []);

  // Data arriving on a minimised panel reopens it: the viz is the primary view.
  useEffect(() => {
    if (!fillParent && hasData && height === 0) restoreDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, fillParent]);

  const cycleSize = useCallback(() => {
    setHeight((previous) => {
      const next = cycledHeight(previous);
      persistHeight(next);
      return next;
    });
  }, []);

  const expandFromCollapsed = useCallback(() => {
    if (isCollapsed || isMinimized) restoreDefault();
  }, [isCollapsed, isMinimized, restoreDefault]);

  const resizeStart = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault();
      drag.current = { startY: clientYOf(e), startHeight: height };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!drag.current) return;
      setHeight(draggedHeight(drag.current.startHeight + clientYOf(e) - drag.current.startY));
    };
    const handleEnd = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistHeight(height);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleMove);
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [height]);

  return {
    height,
    isMinimized,
    isCollapsed,
    isExpanded: height >= VIZ_EXPANDED_HEIGHT,
    heightTransition: drag.current ? "none" : "height 0.2s ease",
    cycleSize,
    expandFromCollapsed,
    resizeStart,
  };
}
