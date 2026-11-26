import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  clampPanelWidth,
  type LangyResizablePlacement,
  resolvePanelWidthBounds,
  stepPanelWidth,
} from "../../../../model/langy-panel-resize.ts";

/**
 * Drag, keyboard and double-click resizing for the panel's free edge. `edge` is the handle's side;
 * dragging away widens. Pointer capture keeps the drag alive for mouse, pen and touch.
 * Spec: specs/langy/langy-panel-layout.feature
 */
export function useLangyPanelResize({
  placement,
  edge,
  widthPx,
  viewportWidth,
}: {
  placement: LangyResizablePlacement;
  edge: "left" | "right";
  widthPx: number;
  viewportWidth: number;
}) {
  const setPanelWidth = useLangyStore((s) => s.setPanelWidth);
  const resetPanelWidth = useLangyStore((s) => s.resetPanelWidth);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const bounds = resolvePanelWidthBounds({ placement, viewportWidth });
  const widens = edge === "left" ? "ArrowLeft" : "ArrowRight";
  const narrows = edge === "left" ? "ArrowRight" : "ArrowLeft";

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { startX: event.clientX, startWidth: widthPx };
    setResizing(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const travel = event.clientX - drag.startX;
    const width = drag.startWidth + (edge === "left" ? -travel : travel);
    setPanelWidth({ placement, width: clampPanelWidth({ placement, viewportWidth, width }) });
  };
  const endDrag = (event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== widens && event.key !== narrows) return;
    event.preventDefault();
    setPanelWidth({
      placement,
      width: stepPanelWidth({
        placement,
        viewportWidth,
        current: widthPx,
        direction: event.key === widens ? "wider" : "narrower",
        large: event.shiftKey,
      }),
    });
  };

  return {
    resizing,
    handleProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize Langy panel",
      "aria-valuenow": widthPx,
      "aria-valuemin": bounds.min,
      "aria-valuemax": bounds.max,
      tabIndex: 0,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick: () => resetPanelWidth(placement),
    } as const,
  };
}
