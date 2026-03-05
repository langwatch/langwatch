import { Box, Card, Grid, HStack, Text } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { BarChart2 } from "lucide-react";
import { useState } from "react";
import { calculateGridPositions, type GridLayout } from "~/utils/gridPositions";
import {
  DraggableGraphCard,
  type GraphData,
  type SizeOption,
} from "./DraggableGraphCard";

interface ReportGridProps {
  graphs: GraphData[];
  projectSlug: string;
  dashboardId?: string;
  onGraphDelete: (graphId: string) => void;
  onGraphSizeChange: (graphId: string, size: SizeOption) => void;
  onGraphsReorder: (layouts: GridLayout[]) => void;
  deletingGraphId: string | null;
}

export function ReportGrid({
  graphs,
  projectSlug,
  dashboardId,
  onGraphDelete,
  onGraphSizeChange,
  onGraphsReorder,
  deletingGraphId,
}: ReportGridProps) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragGraph = graphs.find((g) => g.id === activeDragId);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = graphs.findIndex((g) => g.id === active.id);
    const newIndex = graphs.findIndex((g) => g.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      // Reorder the graphs array
      const newOrder = [...graphs];
      const [removed] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, removed!);

      // Recalculate grid positions for all graphs
      const layouts = calculateGridPositions(newOrder);
      onGraphsReorder(layouts);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={graphs.map((g) => g.id)}
        strategy={rectSortingStrategy}
      >
        <Grid
          templateColumns="repeat(2, 1fr)"
          autoRows="minmax(350px, auto)"
          gap={5}
          width="100%"
        >
          {graphs.map((graph) => (
            <DraggableGraphCard
              key={graph.id}
              graph={graph}
              projectSlug={projectSlug}
              dashboardId={dashboardId}
              onDelete={() => onGraphDelete(graph.id)}
              onSizeChange={(size) => onGraphSizeChange(graph.id, size)}
              isDeleting={deletingGraphId === graph.id}
            />
          ))}
        </Grid>
      </SortableContext>

      <DragOverlay>
        {activeDragGraph ? (
          <Card.Root
            boxShadow="xl"
            opacity={0.9}
            width={activeDragGraph.colSpan === 2 ? "600px" : "300px"}
            height={activeDragGraph.rowSpan === 2 ? "400px" : "200px"}
          >
            <Card.Body>
              <HStack align="center" marginBottom={4}>
                <BarChart2 color="orange" />
                <Text marginLeft={2} fontSize="md" fontWeight="bold">
                  {activeDragGraph.name}
                </Text>
              </HStack>
              <Box
                flex={1}
                background="gray.50"
                borderRadius="md"
                display="flex"
                alignItems="center"
                justifyContent="center"
                color="fg.subtle"
                height="calc(100% - 40px)"
              >
                Chart preview
              </Box>
            </Card.Body>
          </Card.Root>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
