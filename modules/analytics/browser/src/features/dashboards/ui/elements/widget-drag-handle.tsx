/** The grip a widget card is moved by on a board the reader may change. */

import { Box } from "@langwatch/design-system/primitives";
import { GripVertical } from "lucide-react";

import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";

export function WidgetDragHandle() {
  return (
    <Box
      className={CHART_GRID_DRAG_HANDLE_CLASS}
      display="flex"
      alignItems="center"
      justifyContent="center"
      boxSize={6}
      borderRadius="md"
      cursor="grab"
      color="fg.subtle"
      title="Drag to move"
      _hover={{ color: "fg", background: "bg.muted" }}
    >
      <GripVertical size={14} aria-hidden />
    </Box>
  );
}
