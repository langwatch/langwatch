/**
 * The playground's widget grid. Mirrors `components/analytics/reports`'
 * `ReportGrid`: a dnd-kit sortable grid over the same 2-column layout, reusing
 * `calculateGridPositions` to repack on drop. Cards are playground widgets
 * (sandboxed frames) rather than builder/workbench graphs.
 */

import { Grid } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";

import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";
import { calculateGridPositions, type GridLayout } from "~/utils/gridPositions";

import {
  type PlaygroundWidget,
  PlaygroundWidgetCard,
} from "./PlaygroundWidgetCard";

interface PlaygroundWidgetGridProps {
  widgets: PlaygroundWidget[];
  projectId: string;
  projectSlug: string;
  onWidgetDelete: (id: string) => void;
  onWidgetSizeChange: (id: string, size: SizeOption) => void;
  onWidgetEdit: (id: string) => void;
  onWidgetSave: (
    input: { id: string; code: string; queries: PlaygroundQuery[] },
    options?: { onSuccess?: () => void },
  ) => void;
  onWidgetsReorder: (layouts: GridLayout[]) => void;
  deletingWidgetId: string | null;
  savingWidgetId: string | null;
}

export function PlaygroundWidgetGrid({
  widgets,
  projectId,
  projectSlug,
  onWidgetDelete,
  onWidgetSizeChange,
  onWidgetEdit,
  onWidgetSave,
  onWidgetsReorder,
  deletingWidgetId,
  savingWidgetId,
}: PlaygroundWidgetGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = widgets.findIndex((w) => w.id === active.id);
    const newIndex = widgets.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...widgets];
    const [removed] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, removed!);
    onWidgetsReorder(calculateGridPositions(newOrder));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={widgets.map((w) => w.id)}
        strategy={rectSortingStrategy}
      >
        <Grid
          templateColumns="repeat(2, 1fr)"
          autoRows="minmax(350px, auto)"
          gap={5}
          width="100%"
        >
          {widgets.map((widget) => (
            <PlaygroundWidgetCard
              key={widget.id}
              widget={widget}
              projectId={projectId}
              projectSlug={projectSlug}
              onDelete={() => onWidgetDelete(widget.id)}
              onSizeChange={(size) => onWidgetSizeChange(widget.id, size)}
              onEdit={() => onWidgetEdit(widget.id)}
              onSave={onWidgetSave}
              isDeleting={deletingWidgetId === widget.id}
              isSaving={savingWidgetId === widget.id}
            />
          ))}
        </Grid>
      </SortableContext>
    </DndContext>
  );
}
