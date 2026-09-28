import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useRef } from "react";

import {
  DRAWER_DEFAULT_WIDTH_PX,
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../../../../../behavior/drawer.store.ts";

const MAGNET_PX = 32;

/** The widest the drawer may be: the viewport, less the edge it keeps. */
function maxDrawerWidth(): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  return window.innerWidth - DRAWER_MAXIMIZE_EDGE_PX;
}

/**
 * The width a drag proposes. Dragging left widens the drawer, since its right
 * edge is anchored; within MAGNET_PX of the maximum it snaps there, so a full
 * width is easy to commit.
 */
function draggedWidth({ startWidth, dx }: { startWidth: number; dx: number }): number {
  const proposed = startWidth - dx;
  const max = maxDrawerWidth();
  if (proposed >= max - MAGNET_PX) return max;
  return Math.max(DRAWER_MIN_WIDTH_PX, Math.min(max, proposed));
}

/** Where a drag starts: the set width, or the default capped at the viewport. */
function startingWidth(widthPx: number | null): number {
  if (widthPx !== null) return widthPx;
  if (typeof window === "undefined") return DRAWER_DEFAULT_WIDTH_PX;
  return Math.min(DRAWER_DEFAULT_WIDTH_PX, window.innerWidth);
}

/** Whether the drawer sits at the maximum snap; the default width never does. */
function isAtMaxSnap(widthPx: number | null): boolean {
  if (typeof window === "undefined" || widthPx === null) return false;
  return Math.abs(widthPx - maxDrawerWidth()) < 2;
}

/**
 * Re-clamps the width when the viewport shrinks, so a drawer dragged wide on a
 * big monitor does not hang off the edge of a smaller window.
 */
function useClampOnViewportResize({
  widthPx,
  setWidthPx,
}: {
  widthPx: number | null;
  setWidthPx: (width: number) => void;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      const max = maxDrawerWidth();
      if (widthPx !== null && widthPx > max) setWidthPx(max);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [widthPx, setWidthPx]);
}

/**
 * Left-edge resize rail for the trace drawer.
 */
export function ResizeRail() {
  const widthPx = useDrawerStore((s) => s.widthPx);
  const setWidthPx = useDrawerStore((s) => s.setWidthPx);
  const toggleSnapMaximize = useDrawerStore((s) => s.toggleSnapMaximize);

  const dragState = useRef<{ startX: number; startWidth: number; didMove: boolean } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Primary button only, so a context menu never starts a drag it cannot end.
      // No preventDefault: a double-click without a drag must still reach dblclick.
      if (e.button !== 0) return;
      dragState.current = { startX: e.clientX, startWidth: startingWidth(widthPx), didMove: false };
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // setPointerCapture can throw on a detached node; capture is best-effort.
      }
    },
    [widthPx],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (Math.abs(dx) > 2) drag.didMove = true;
      setWidthPx(draggedWidth({ startWidth: drag.startWidth, dx }));
    },
    [setWidthPx],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Release is best-effort too.
    }
  }, []);

  // A drag that lands within the double-click threshold does not also snap.
  const handleDoubleClick = useCallback(() => {
    if (dragState.current?.didMove || typeof window === "undefined") return;
    toggleSnapMaximize(window.innerWidth);
  }, [toggleSnapMaximize]);

  useClampOnViewportResize({ widthPx, setWidthPx });

  // At the maximum snap the pill hides; the rail reappears on hover to grab.
  const atMaxSnap = isAtMaxSnap(widthPx);

  return (
    <Box
      data-edge-grip="true"
      position="absolute"
      top={0}
      bottom={0}
      // Sit OUTSIDE the drawer with a visible gap between the pill and
      // the drawer's left edge. The hit area is generous (28px) and
      // straddles the gap: it extends 18px into the gutter (where the
      // pill lives) and 10px into the drawer for forgiving inward grabs.
      left="-18px"
      width="28px"
      // No tab focus on purpose — see component-level docstring.
      cursor="col-resize"
      // Above the drawer body but below any toasts / overlays.
      zIndex={20}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      aria-hidden="true"
      _hover={{ "& > [data-edge-pill]": { opacity: 1 } }}
    >
      <Box
        data-edge-pill
        position="absolute"
        top="50%"
        // Pill sits flush to the left edge of the rail (deep in the
        // gutter), leaving a clear ~10px breathing strip between the
        // pill and the drawer's left edge so the chrome reads as
        // detached, not glued.
        left="4px"
        width="4px"
        height="40px"
        borderRadius="full"
        bg="gray.emphasized"
        opacity={atMaxSnap ? 0 : 0.5}
        transition="opacity 120ms ease"
        pointerEvents="none"
        style={{ transform: "translateY(-50%)" }}
      />
    </Box>
  );
}
