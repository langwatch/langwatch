import { Box } from "@chakra-ui/react";
import type { Header } from "@tanstack/react-table";
import type React from "react";

interface ColumnResizeGripProps<T> {
  header: Header<T, unknown>;
}

/**
 * Right-edge handle that drives TanStack's column-resize state. The header
 * cell positions this absolutely against its right border; we don't pick a
 * position — we just consume `header.getResizeHandler()` (which already
 * wires mouse + touch + keyboard) and reflect `getIsResizing()` for visual
 * feedback. Lifted out of `TraceTableShell` so the resize affordance lives
 * in one place and the header cell doesn't grow a fourth responsibility.
 *
 * Double-click resets the column to its default size — the canonical
 * pattern from TanStack examples — so users can recover from an accidental
 * drag without opening the column menu.
 */
export function ColumnResizeGrip<T>({
  header,
}: ColumnResizeGripProps<T>): React.ReactElement | null {
  if (!header.column.getCanResize()) return null;
  const isResizing = header.column.getIsResizing();

  return (
    <Box
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        header.column.resetSize();
      }}
      position="absolute"
      top={0}
      right={0}
      width="6px"
      height="full"
      cursor="col-resize"
      userSelect="none"
      touchAction="none"
      zIndex={1}
      bg={isResizing ? "blue.fg" : "transparent"}
      opacity={isResizing ? 0.55 : 1}
      _hover={{ bg: "border.emphasized" }}
      aria-hidden="true"
    />
  );
}
