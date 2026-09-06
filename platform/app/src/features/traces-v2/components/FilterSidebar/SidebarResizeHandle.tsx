import { Box } from "@chakra-ui/react";
import { useCallback, useRef, useState } from "react";

interface SidebarResizeHandleProps {
  /** Current pixel width — start of each drag uses this as the anchor. */
  currentWidth: number;
  /** Called with the new width while dragging (continuous). */
  onResize: (width: number) => void;
  /**
   * Called once when the drag ends (pointer-up or pointer-cancel).
   * Lets callers do the heavy work (e.g. localStorage persistence)
   * once at the end instead of on every `onResize` frame, which
   * jitters the resize.
   */
  onResizeEnd?: () => void;
  /** Min before the drag commits a collapse instead of a resize. */
  collapseBelow: number;
  /** Called once when the drag goes below `collapseBelow`. */
  onCollapse: () => void;
  /** Max width the operator can drag to. */
  max: number;
}

/**
 * 1px right-edge separator with a forgiving hit zone + drag-to-resize.
 * Mirrors the drawer's `PaneResizeBar` affordance: invisible 4px strip,
 * 1px visible line that lights blue on hover / drag via the
 * `data-resize-handle-state` attribute. Dragging past `collapseBelow`
 * commits a collapse instead of a sub-threshold width — same UX as the
 * trace v2 drawer panels.
 */
export function SidebarResizeHandle({
  currentWidth,
  onResize,
  onResizeEnd,
  collapseBelow,
  onCollapse,
  max,
}: SidebarResizeHandleProps) {
  const [state, setState] = useState<"idle" | "hover" | "drag">("idle");
  const startXRef = useRef<number | null>(null);
  const startWidthRef = useRef<number>(currentWidth);
  const collapsedRef = useRef<boolean>(false);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      startXRef.current = event.clientX;
      startWidthRef.current = currentWidth;
      collapsedRef.current = false;
      setState("drag");
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [currentWidth],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (startXRef.current == null) return;
      const delta = event.clientX - startXRef.current;
      const next = Math.min(max, startWidthRef.current + delta);
      if (next < collapseBelow) {
        if (!collapsedRef.current) {
          collapsedRef.current = true;
          onCollapse();
        }
        return;
      }
      collapsedRef.current = false;
      onResize(next);
    },
    [collapseBelow, max, onCollapse, onResize],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (startXRef.current == null) return;
      startXRef.current = null;
      collapsedRef.current = false;
      setState("hover");
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // releasePointerCapture throws if the pointer was never captured
        // (e.g. cancel events fired before pointerdown completed). Safe to
        // ignore — the drag is already over.
      }
      onResizeEnd?.();
    },
    [onResizeEnd],
  );

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize filters sidebar"
      data-resize-handle-state={state}
      position="absolute"
      top={0}
      right={0}
      bottom={0}
      width="4px"
      cursor="col-resize"
      // Lift above the table contents so the handle is grabbable even when
      // a cell hover effect or chip would normally win the pointer.
      zIndex={2}
      onPointerEnter={() => {
        if (startXRef.current == null) setState("hover");
      }}
      onPointerLeave={() => {
        if (startXRef.current == null) setState("idle");
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "1px",
        right: "1px",
        // Idle: same neutral tone the drawer's PaneResizeBar uses so the
        // sidebar still has a visible right edge. Hover/drag lights blue
        // for the "grab me" affordance.
        background:
          state === "idle"
            ? "var(--chakra-colors-border)"
            : "var(--chakra-colors-blue-solid)",
        transition: "background 100ms ease",
      }}
    />
  );
}
