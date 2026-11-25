/**
 * The grip on a column's right edge that drags it wider or narrower. It sits inside a positioned
 * column and reports widths; the column owns the width and where it is kept.
 */
import { Box } from "@chakra-ui/react";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";

export interface ResizeHandleProps {
  /** Names the column for assistive technology, e.g. "Resize sidebar". */
  label: string;
  /** The column's width in pixels. */
  value: number;
  min: number;
  max: number;
  /** Called with every new width, already kept between `min` and `max`. */
  onChange: (width: number) => void;
  /** Double-click, or Enter on the keyboard, puts the column back to its default width. */
  onReset?: () => void;
  /** Pixels one arrow key press moves the edge. */
  step?: number;
}

export function clampWidth({ width, min, max }: { width: number; min: number; max: number }) {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  onReset,
  step = 16,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const change = (width: number) => onChange(clampWidth({ width, min, max }));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // Without this the drag selects the menu's text as the pointer moves.
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: value };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    change(drag.current.startWidth + event.clientX - drag.current.startX);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyedWidth({ key: event.key, value, min, max, step });
    if (event.key === "Enter" && onReset) {
      event.preventDefault();
      onReset();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    change(next);
  };

  return (
    <Box
      as="hr"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={isDragging ? "" : void 0}
      position="absolute"
      top={0}
      right="-3px"
      bottom={0}
      width="6px"
      height="auto"
      margin={0}
      borderWidth={0}
      zIndex={2}
      cursor="col-resize"
      touchAction="none"
      outline="none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      _before={{
        content: '""',
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "2px",
        width: "2px",
        borderRadius: "full",
        background: "transparent",
        transition: "background 120ms ease",
      }}
      css={{
        "&:hover::before, &[data-dragging]::before, &:focus-visible::before": {
          background: "var(--chakra-colors-border-emphasized)",
        },
      }}
    />
  );
}

/** The width an arrow, Home or End key asks for; null for any other key. */
function keyedWidth({
  key,
  value,
  min,
  max,
  step,
}: {
  key: string;
  value: number;
  min: number;
  max: number;
  step: number;
}): number | null {
  if (key === "ArrowRight") return value + step;
  if (key === "ArrowLeft") return value - step;
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}
