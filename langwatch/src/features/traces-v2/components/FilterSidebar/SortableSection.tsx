import { Box } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type React from "react";

interface SortableSectionRenderArgs {
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>;
  isDragging: boolean;
}

interface SortableSectionProps {
  id: string;
  children: (args: SortableSectionRenderArgs) => React.ReactNode;
}

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
      zIndex={isDragging ? 1 : undefined}
    >
      {children({ dragHandleProps, isDragging })}
    </Box>
  );
};
