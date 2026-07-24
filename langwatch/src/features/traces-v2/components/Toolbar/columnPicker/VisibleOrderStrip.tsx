import { Box, HStack, Icon, IconButton, Stack, Text } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import type React from "react";
import type { LensColumnOption } from "../../../lens/capabilities";

/**
 * Compact drag-to-reorder strip of the visible columns. Each row is
 * draggable by its grip and carries move-up / move-down / remove controls.
 */
export const VisibleOrderStrip: React.FC<{
  columns: LensColumnOption[];
  columnOrder: string[];
  reorderColumns: (from: number, to: number) => void;
  onRemove: (id: string) => void;
}> = ({ columns, columnOrder, reorderColumns, onRemove }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = columns.findIndex((c) => c.id === String(active.id));
    const toIdx = columns.findIndex((c) => c.id === String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    reorderColumns(
      columnOrder.indexOf(columns[fromIdx]!.id),
      columnOrder.indexOf(columns[toIdx]!.id),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columns.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        <Stack gap={0}>
          {columns.map((column, index) => (
            <SortableVisibleColumnRow
              key={column.id}
              column={column}
              isFirst={index === 0}
              isLast={index === columns.length - 1}
              onMoveUp={() => {
                const previous = columns[index - 1];
                if (!previous) return;
                reorderColumns(
                  columnOrder.indexOf(column.id),
                  columnOrder.indexOf(previous.id),
                );
              }}
              onMoveDown={() => {
                const next = columns[index + 1];
                if (!next) return;
                reorderColumns(
                  columnOrder.indexOf(column.id),
                  columnOrder.indexOf(next.id),
                );
              }}
              onRemove={() => onRemove(column.id)}
            />
          ))}
        </Stack>
      </SortableContext>
    </DndContext>
  );
};

const ReorderIconButton: React.FC<{
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, disabled, onClick, children }) => (
  <IconButton
    aria-label={label}
    size="2xs"
    variant="ghost"
    color="fg.subtle"
    minWidth="18px"
    height="18px"
    disabled={disabled}
    onClick={onClick}
  >
    {children}
  </IconButton>
);

const SortableVisibleColumnRow: React.FC<{
  column: LensColumnOption;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}> = ({ column, isFirst, isLast, onMoveUp, onMoveDown, onRemove }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });
  return (
    <HStack
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      gap={0.5}
      paddingY={1}
      paddingRight={0.5}
      borderRadius="sm"
      _hover={{ bg: "bg.muted" }}
    >
      <Box
        {...attributes}
        {...(listeners ?? {})}
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        boxSize="12px"
        color="fg.subtle"
        cursor="grab"
        _active={{ cursor: "grabbing" }}
        aria-label={`Drag to reorder ${column.label}`}
        title={`Drag to reorder ${column.label}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Icon boxSize="10px">
          <GripVertical />
        </Icon>
      </Box>
      <Text flex={1} textStyle="xs" color="fg" truncate>
        {column.label}
      </Text>
      <ReorderIconButton
        label={`Move ${column.label} up`}
        disabled={isFirst}
        onClick={onMoveUp}
      >
        <ArrowUp size={10} />
      </ReorderIconButton>
      <ReorderIconButton
        label={`Move ${column.label} down`}
        disabled={isLast}
        onClick={onMoveDown}
      >
        <ArrowDown size={10} />
      </ReorderIconButton>
      <ReorderIconButton label={`Remove ${column.label}`} onClick={onRemove}>
        <X size={10} />
      </ReorderIconButton>
    </HStack>
  );
};
