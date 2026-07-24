import { Box } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";
import { useMemo } from "react";

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
  /**
   * True while any item in the list is being dragged. Used to make the
   * dragged source row invisible (opacity:0) so the DragOverlay ghost is
   * the only thing moving — avoids the "double section" effect.
   */
  isAnyDragging?: boolean;
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
  isAnyDragging = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  // Stabilise the drag-handle props reference: @dnd-kit returns fresh
  // `attributes`/`listeners` objects on every render. Memoising by
  // `isDragging` (the only state that changes their effective content)
  // keeps the child render-prop receiving a stable reference, which lets
  // React.memo on child components skip re-renders for non-moving rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dragHandleProps = useMemo(
    () =>
      ({
        ...attributes,
        ...(listeners ?? {}),
      }) as React.HTMLAttributes<HTMLDivElement>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDragging],
  );

  return (
    <Box
      ref={setNodeRef}
      style={{
        // CSS.Translate skips scale — we only need positional offset during
        // drag, which avoids the layout jank a full Transform can produce.
        // willChange is set only while this node is actually being moved so
        // we don't burn GPU layers for every item in the list.
        transform: CSS.Translate.toString(transform),
        transition,
        willChange: isDragging ? "transform" : undefined,
        contain: "layout paint",
      }}
      position="relative"
      // Make the source row fully invisible while a DragOverlay ghost is
      // rendering it — without this users see both the dragging ghost AND
      // the original row at 0.6 opacity.
      opacity={isDragging && isAnyDragging ? 0 : 1}
      zIndex={isDragging ? 1 : undefined}
    >
      {children(dragHandleProps)}
    </Box>
  );
};
