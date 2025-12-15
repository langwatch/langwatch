import { Box, Card, Grid, HStack, Text } from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useState } from "react";
import { BarChart2 } from "react-feather";
import {
  DraggableGraphCard,
  type GraphData,
  type SizeOption,
} from "./DraggableGraphCard";

interface ReportGridProps {
  graphs: GraphData[];
  projectSlug: string;
  onGraphDelete: (graphId: string) => void;
  onGraphSizeChange: (graphId: string, size: SizeOption) => void;
  onGraphsReorder: (
    layouts: Array<{
      graphId: string;
      gridColumn: number;
      gridRow: number;
      colSpan: number;
      rowSpan: number;
    }>,
  ) => void;
  deletingGraphId: string | null;
}

export function ReportGrid({
  graphs,
  projectSlug,
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

  function handleDragStart(event: any) {
    setActiveDragId(event.active.id);
  }

  function handleDragEnd(event: DragEndEvent) {
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
  }

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
                color="gray.400"
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

/**
 * Calculate grid positions for graphs after reordering.
 * This uses a simple row-by-row layout algorithm.
 */
function calculateGridPositions(
  graphs: GraphData[],
): Array<{
  graphId: string;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}> {
  const layouts: Array<{
    graphId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }> = [];

  // Track which cells are occupied
  // Grid is 2 columns wide, rows are dynamically added
  const occupied: Set<string> = new Set();

  const cellKey = (col: number, row: number) => `${col},${row}`;

  const isAreaFree = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number,
  ) => {
    for (let c = col; c < col + colSpan; c++) {
      for (let r = row; r < row + rowSpan; r++) {
        if (c >= 2 || occupied.has(cellKey(c, r))) {
          return false;
        }
      }
    }
    return true;
  };

  const occupyArea = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number,
  ) => {
    for (let c = col; c < col + colSpan; c++) {
      for (let r = row; r < row + rowSpan; r++) {
        occupied.add(cellKey(c, r));
      }
    }
  };

  for (const graph of graphs) {
    const { colSpan, rowSpan } = graph;

    // Find the first available position
    let placed = false;
    let row = 0;

    while (!placed) {
      for (let col = 0; col <= 2 - colSpan; col++) {
        if (isAreaFree(col, row, colSpan, rowSpan)) {
          occupyArea(col, row, colSpan, rowSpan);
          layouts.push({
            graphId: graph.id,
            gridColumn: col,
            gridRow: row,
            colSpan,
            rowSpan,
          });
          placed = true;
          break;
        }
      }
      if (!placed) {
        row++;
      }
    }
  }

  return layouts;
}

// Export for use when size changes
export { calculateGridPositions };
