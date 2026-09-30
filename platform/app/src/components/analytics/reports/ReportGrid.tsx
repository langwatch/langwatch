import type { ChartGridPlacement } from "~/server/analytics/chartGrid";
import { ChartGrid } from "./ChartGrid";
import { DraggableGraphCard, type GraphData } from "./DraggableGraphCard";

interface ReportGridProps {
  graphs: GraphData[];
  projectSlug: string;
  projectId: string;
  dashboardId?: string;
  onGraphDelete: (graphId: string) => void;
  onGraphGranularityChange?: (input: {
    graphId: string;
    granularitySeconds: number;
  }) => void;
  onGraphsPlacementChange: (placements: ChartGridPlacement[]) => void;
  deletingGraphId: string | null;
}

/**
 * The analytics dashboard's grid of chart cards — every chart placed on the
 * active dashboard, on the shared `ChartGrid`.
 */
export function ReportGrid({
  graphs,
  projectSlug,
  projectId,
  dashboardId,
  onGraphDelete,
  onGraphGranularityChange,
  onGraphsPlacementChange,
  deletingGraphId,
}: ReportGridProps) {
  const graphById = new Map(graphs.map((graph) => [graph.id, graph]));
  const placements = graphs.map((graph) => ({
    graphId: graph.id,
    gridColumn: graph.gridColumn,
    gridRow: graph.gridRow,
    colSpan: graph.colSpan,
    rowSpan: graph.rowSpan,
  }));

  return (
    <ChartGrid
      placements={placements}
      onPlacementsCommit={onGraphsPlacementChange}
      renderCard={({ graphId }) => {
        const graph = graphById.get(graphId);
        if (!graph) return null;
        return (
          <DraggableGraphCard
            graph={graph}
            projectSlug={projectSlug}
            projectId={projectId}
            dashboardId={dashboardId}
            onDelete={() => onGraphDelete(graph.id)}
            {...(onGraphGranularityChange
              ? {
                  onGranularityChange: (granularitySeconds: number) =>
                    onGraphGranularityChange({
                      graphId: graph.id,
                      granularitySeconds,
                    }),
                }
              : {})}
            isDeleting={deletingGraphId === graph.id}
          />
        );
      }}
    />
  );
}
