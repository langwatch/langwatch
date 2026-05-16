import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useRef } from "react";
import {
  DRAWER_DEFAULT_WIDTH_PX,
  DRAWER_MAXIMIZE_EDGE_PX,
  DRAWER_MIN_WIDTH_PX,
  useDrawerStore,
} from "../../../stores/drawerStore";

/**
 * Left-edge resize rail for the trace drawer.
 *
 * Inspired by the evaluations-v3 EditableCell expansion handle: a
 * thin vertical pill sits centered on the outer edge of the drawer with
 * a generous full-height invisible hit area around it. The whole rail is
 * draggable; the visible pill is purely an affordance.
 *
 * Gestures:
 *   - drag (pointerdown + move) → continuous width update
 *   - double-click → snap-maximize / restore (no single-click toggle)
 *
 * The rail intentionally does not receive keyboard focus — Tab should
 * never land on the invisible chrome. The M shortcut covers the
 * keyboard-driven maximize path.
 */
export function ResizeRail() {
  const widthPx = useDrawerStore((s) => s.widthPx);
  const setWidthPx = useDrawerStore((s) => s.setWidthPx);
  const toggleSnapMaximize = useDrawerStore((s) => s.toggleSnapMaximize);

  const dragState = useRef<{
    startX: number;
    startWidth: number;
    pointerId: number;
    didMove: boolean;
  } | null>(null);

  const resolveCurrentWidth = useCallback(() => {
    if (widthPx !== null) return widthPx;
    if (typeof window === "undefined") return DRAWER_DEFAULT_WIDTH_PX;
    // Cap at the viewport so a default wider than the window doesn't
    // start the drag from off-screen.
    return Math.min(DRAWER_DEFAULT_WIDTH_PX, window.innerWidth);
  }, [widthPx]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore non-primary buttons so a right-click context menu doesn't
      // start a drag we can't cancel.
      if (e.button !== 0) return;
      // Don't preventDefault — we want the browser to still emit the
      // synthetic dblclick when the user double-clicks without dragging.
      const startWidth = resolveCurrentWidth();
      dragState.current = {
        startX: e.clientX,
        startWidth,
        pointerId: e.pointerId,
        didMove: false,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        // setPointerCapture can throw on detached nodes — best-effort.
      }
    },
    [resolveCurrentWidth],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      // Dragging *left* widens the drawer (its right edge is anchored to
      // the viewport), so subtract dx.
      const proposed = drag.startWidth - dx;
      const maxWidth =
        typeof window !== "undefined"
          ? window.innerWidth - DRAWER_MAXIMIZE_EDGE_PX
          : Number.POSITIVE_INFINITY;
      let clamped = Math.max(
        DRAWER_MIN_WIDTH_PX,
        Math.min(maxWidth, proposed),
      );
      // Magnet snap: when the user drags the rail within ~32px of the
      // viewport edge (i.e., proposed width is within 32px of max), snap
      // to the max-edge value so it's easy to commit a full-screen
      // expansion without having to be pixel-perfect.
      const MAGNET_PX = 32;
      if (proposed >= maxWidth - MAGNET_PX) {
        clamped = maxWidth;
      }
      if (Math.abs(dx) > 2) drag.didMove = true;
      setWidthPx(clamped);
    },
    [setWidthPx],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current;
      if (!drag) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // Best-effort release.
      }
      dragState.current = null;
    },
    [],
  );

  const handleDoubleClick = useCallback(() => {
    // Only toggle the snap if the user wasn't dragging — a drag that
    // happens to land within the dblclick threshold should not also
    // snap the width.
    if (dragState.current?.didMove) return;
    if (typeof window === "undefined") return;
    toggleSnapMaximize(window.innerWidth);
  }, [toggleSnapMaximize]);

  // Re-clamp the width if the viewport itself shrinks (window resize). A
  // user who dragged to 1200px on a wide monitor and then docks a smaller
  // window would otherwise see the drawer hang off the right edge until
  // they touched the rail again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      if (widthPx === null) return;
      const max = window.innerWidth - DRAWER_MAXIMIZE_EDGE_PX;
      if (widthPx > max) setWidthPx(max);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [widthPx, setWidthPx]);

  // Determine whether the drawer is at the max-snap width. When it is,
  // we hide the pill — the rail is invisible chrome that only re-appears
  // on hover for the operator to grab the edge back. The default flat
  // `DRAWER_DEFAULT_WIDTH_PX` fallback (`widthPx === null`) is never
  // "at max" so the pill is always visible there.
  const atMaxSnap = (() => {
    if (typeof window === "undefined" || widthPx === null) return false;
    const max = window.innerWidth - DRAWER_MAXIMIZE_EDGE_PX;
    return Math.abs(widthPx - max) < 2;
  })();

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
      role="separator"
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
