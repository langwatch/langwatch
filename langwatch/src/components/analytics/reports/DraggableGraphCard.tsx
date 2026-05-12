import { Box, Card } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import type { FilterField } from "~/server/filters/types";
import { GraphCardHeader } from "./GraphCardHeader";
import type { SizeOption } from "./GraphCardMenu";

interface GraphData {
  id: string;
  name: string;
  graph: unknown;
  filters: unknown;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  trigger?: {
    id: string;
    active: boolean;
    alertType: string | null;
  } | null;
}

interface DraggableGraphCardProps {
  graph: GraphData;
  projectSlug: string;
  dashboardId?: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
  isDeleting: boolean;
}

export function DraggableGraphCard({
  graph,
  projectSlug,
  dashboardId,
  onDelete,
  onSizeChange,
  isDeleting,
}: DraggableGraphCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: graph.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: `span ${graph.colSpan}`,
    gridRow: `span ${graph.rowSpan}`,
  };

  // Calculate height based on rowSpan
  const graphHeight = graph.rowSpan === 2 ? 600 : 300;

  return (
    <Box ref={setNodeRef} style={style} minWidth={0}>
      <Card.Root height="full" minWidth={0}>
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
        >
          <GraphCardHeader
            graphId={graph.id}
            name={graph.name}
            graph={graph.graph}
            projectSlug={projectSlug}
            dashboardId={dashboardId}
            colSpan={graph.colSpan}
            rowSpan={graph.rowSpan}
            filters={graph.filters}
            trigger={graph.trigger}
            isDragging={isDragging}
            dragAttributes={attributes}
            dragListeners={listeners}
            onSizeChange={onSizeChange}
            onDelete={onDelete}
            isDeleting={isDeleting}
          />

          <Box flex={1} minHeight={0}>
            <CustomGraph
              key={graph.id}
              input={{
                ...(graph.graph as CustomGraphInput),
                height: graphHeight,
              }}
              filters={
                graph.filters as
                  | Record<FilterField, string[] | Record<string, string[]>>
                  | undefined
              }
            />
          </Box>
        </Card.Body>
      </Card.Root>
    </Box>
  );
}

export type { SizeOption, GraphData };
// Re-export from GraphCardMenu for backwards compatibility
export { getCurrentSize, sizeOptions } from "./GraphCardMenu";
