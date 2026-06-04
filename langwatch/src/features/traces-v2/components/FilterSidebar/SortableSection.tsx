import { Box } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";

interface SortableSectionProps {
  /** Sortable id — convention is the section's facet key. */
  id: string;
  /**
   * Renders the section. Receives the drag handle props the wrapper
   * obtained from `useSortable` so the SidebarSection inside can paint
   * the GripVertical handle at the header level. Passed via render-prop
   * instead of cloneElement so the SectionRenderer's typing stays
   * intact.
   */
  children: (
    dragHandleProps: React.HTMLAttributes<HTMLDivElement>,
  ) => React.ReactNode;
}

/**
 * Wraps a single facet section in a `useSortable` node so the operator
 * can drag-reorder the flat sidebar list. Replaces the previous
 * group-level FacetGroupHeader sortable now that group headings are
 * gone from the sidebar. The drag handle is rendered at the section's
 * own header (GripVertical in SidebarSection), so the wrapper itself
 * adds no chrome — just the transform / opacity / z-index needed for
 * the in-flight drag preview.
 */
export const SortableSection: React.FC<SortableSectionProps> = ({
  id,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragHandleProps = {
    ...attributes,
    ...(listeners ?? {}),
  } as React.HTMLAttributes<HTMLDivElement>;

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      position="relative"
      opacity={isDragging ? 0.6 : 1}
      // Raise above siblings so the dragged section paints over its
      // neighbours during the gesture. The same trick FacetGroupHeader
      // used.
      zIndex={isDragging ? 1 : undefined}
    >
      {children(dragHandleProps)}
    </Box>
  );
};
