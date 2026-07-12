/**
 * charts-proto — the dashboard grid (PROTOTYPE).
 *
 * A 12-column sortable grid of widget cards (drag to rearrange), which is a step
 * beyond today's fixed 2-column bin-pack — the free-er grid the design doc flags
 * as the biggest structural gap. Widgets size themselves via colSpan/rowSpan.
 */
import { Box, Grid } from "@chakra-ui/react";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useState } from "react";
import type { WidgetSpec } from "./model";
import type { StubWindow } from "./stubData";
import { GRID_GAP, GRID_ROW_HEIGHT, WidgetCard } from "./WidgetCard";

interface Props {
  widgets: WidgetSpec[];
  window: StubWindow;
  onReorder: (fromId: string, toId: string) => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onResize: (id: string, colSpan: number, rowSpan: number) => void;
}

export function DashboardGrid({
  widgets,
  window: win,
  onReorder,
  onEdit,
  onDuplicate,
  onDelete,
  onResize,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeWidget = widgets.find((w) => w.id === activeId) ?? null;

  const handleDragStart = (e: DragStartEvent) =>
    setActiveId(String(e.active.id));

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <Grid
          templateColumns="repeat(12, 1fr)"
          autoRows={`${GRID_ROW_HEIGHT}px`}
          gap={`${GRID_GAP}px`}
          gridAutoFlow="row dense"
        >
          {widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              spec={widget}
              window={win}
              onEdit={() => onEdit(widget.id)}
              onDuplicate={() => onDuplicate(widget.id)}
              onDelete={() => onDelete(widget.id)}
              onResize={(colSpan, rowSpan) => onResize(widget.id, colSpan, rowSpan)}
            />
          ))}
        </Grid>
      </SortableContext>
      <DragOverlay>
        {activeWidget ? (
          <Box
            borderWidth="1px"
            borderColor="orange.400"
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
            paddingX={3}
            paddingY={2}
            fontWeight="600"
            fontSize="sm"
          >
            {activeWidget.title}
          </Box>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
