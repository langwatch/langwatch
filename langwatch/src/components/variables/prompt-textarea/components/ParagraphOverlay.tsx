import { Box } from "@chakra-ui/react";
import { GripVertical } from "lucide-react";
import type { DragEvent } from "react";

type ParagraphPosition = {
  top: number;
  height: number;
};

type ParagraphOverlayProps = {
  positions: ParagraphPosition[];
  hoveredParagraph: number | null;
  gripHoveredParagraph: number | null;
  draggedParagraph: number | null;
  dropTargetParagraph: number | null;
  onGripHover: (index: number | null) => void;
  onDragStart: (e: DragEvent, index: number) => void;
  onDragEnd: () => void;
};

/**
 * Renders paragraph drag handles and visual feedback overlays
 * for drag-and-drop reordering in borderless mode.
 */
export function ParagraphOverlay({
  positions,
  hoveredParagraph,
  gripHoveredParagraph,
  draggedParagraph,
  dropTargetParagraph,
  onGripHover,
  onDragStart,
  onDragEnd,
}: ParagraphOverlayProps) {
  if (positions.length <= 1) return null;

  return (
    <>
      {/* Line highlight on hover (full width) - only when hovering grip */}
      {gripHoveredParagraph !== null &&
        draggedParagraph === null &&
        positions[gripHoveredParagraph] && (
          <Box
            position="absolute"
            top={`${positions[gripHoveredParagraph]?.top ?? 0}px`}
            left={0}
            right={0}
            height={`${positions[gripHoveredParagraph]?.height ?? 0}px`}
            background="gray.100"
            pointerEvents="none"
            borderRadius="md"
          />
        )}

      {/* Dragged line highlight (reduced opacity) */}
      {draggedParagraph !== null && positions[draggedParagraph] && (
        <Box
          position="absolute"
          top={`${positions[draggedParagraph]?.top ?? 0}px`}
          left={0}
          right={0}
          height={`${positions[draggedParagraph]?.height ?? 0}px`}
          background="blue.50"
          opacity={0.5}
          pointerEvents="none"
          borderRadius="md"
        />
      )}

      {/* Grip handles */}
      <Box
        position="absolute"
        top={0}
        left={0}
        width="24px"
        height="100%"
        pointerEvents="none"
      >
        {positions.map((pos, idx) => (
          <Box
            key={`grip-${idx}`}
            position="absolute"
            top={`${pos.top}px`}
            left={0}
            height={`${pos.height}px`}
            width="24px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            pointerEvents="auto"
            cursor={draggedParagraph === idx ? "grabbing" : "grab"}
            opacity={hoveredParagraph === idx || draggedParagraph === idx ? 1 : 0}
            transition="opacity 0.1s"
            draggable
            onMouseEnter={() => onGripHover(idx)}
            onMouseLeave={() => onGripHover(null)}
            onDragStart={(e) => onDragStart(e as unknown as DragEvent, idx)}
            onDragEnd={onDragEnd}
            borderRadius="md"
            _hover={{ background: "gray.100" }}
          >
            <Box color="gray.400">
              <GripVertical size={14} />
            </Box>
          </Box>
        ))}
      </Box>

      {/* Drop indicator line */}
      {draggedParagraph !== null &&
        dropTargetParagraph !== null &&
        dropTargetParagraph !== draggedParagraph && (
          <Box
            position="absolute"
            top={`${
              dropTargetParagraph < positions.length
                ? (positions[dropTargetParagraph]?.top ?? 0) - 1
                : (positions[positions.length - 1]?.top ?? 0) +
                  (positions[positions.length - 1]?.height ?? 0) -
                  1
            }px`}
            left={0}
            right={0}
            height="2px"
            background="blue.500"
            pointerEvents="none"
            zIndex={10}
            borderRadius="full"
          />
        )}
    </>
  );
}

