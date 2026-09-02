import { Box, Card } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { LangWatchQLDashboardWidget } from "~/features/analytics-query/components/LangWatchQLDashboardWidget";
import { DashboardWidgetFrame } from "~/features/custom-chart-playground/DashboardWidgetFrame";
import {
  DASHBOARD_SRCDOC_CHART_KIND,
  WORKBENCH_SQL_CHART_KIND,
} from "~/server/analytics/chartKinds";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";
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
  /**
   * Which kind of chart this row is. Absent on rows read by a caller that does
   * not select it, which reads as a builder graph — the kind every row was
   * before the discriminator existed.
   */
  kind?: string | null;
  /**
   * The datapoint step a placed workbench chart was given, in seconds. Only
   * meaningful for `workbench_sql` rows.
   */
  granularitySeconds?: LangWatchQLGranularityStep | null;
  trigger?: {
    id: string;
    active: boolean;
    alertType: string | null;
  } | null;
}

interface DraggableGraphCardProps {
  graph: GraphData;
  projectSlug: string;
  projectId: string;
  dashboardId?: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  isDeleting: boolean;
}

export function DraggableGraphCard({
  graph,
  projectSlug,
  projectId,
  dashboardId,
  onDelete,
  onSizeChange,
  onGranularityChange,
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

  const isWorkbenchChart = graph.kind === WORKBENCH_SQL_CHART_KIND;
  const isDashboardWidget = graph.kind === DASHBOARD_SRCDOC_CHART_KIND;

  return (
    <Box ref={setNodeRef} style={style} minWidth={0}>
      <Card.Root
        height="full"
        minWidth={0}
        borderRadius="xl"
        boxShadow="0 1px 2px rgba(16,16,32,0.04)"
      >
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
          paddingX={4}
          paddingTop="14px"
          paddingBottom={3}
        >
          <GraphCardHeader
            graphId={graph.id}
            name={graph.name}
            graph={graph.graph}
            projectId={projectId}
            projectSlug={projectSlug}
            dashboardId={dashboardId}
            colSpan={graph.colSpan}
            rowSpan={graph.rowSpan}
            filters={graph.filters}
            trigger={graph.trigger}
            isWorkbenchChart={isWorkbenchChart}
            isDashboardWidget={isDashboardWidget}
            {...(graph.granularitySeconds == null
              ? {}
              : { granularitySeconds: graph.granularitySeconds })}
            isDragging={isDragging}
            dragAttributes={attributes}
            dragListeners={listeners}
            onSizeChange={onSizeChange}
            {...(onGranularityChange ? { onGranularityChange } : {})}
            onDelete={onDelete}
            isDeleting={isDeleting}
          />

          <Box flex={1} minHeight={0}>
            <GraphCardChartArea
              graph={graph}
              projectId={projectId}
              projectSlug={projectSlug}
            />
          </Box>
        </Card.Body>
      </Card.Root>
    </Box>
  );
}

/**
 * The card's chart, routed by the row's kind: a placed workbench chart mounts
 * the live LangWatchQL widget, a dashboard widget mounts its sandboxed
 * frame, and every other row is a builder graph.
 */
function GraphCardChartArea({
  graph,
  projectId,
  projectSlug,
}: {
  graph: GraphData;
  projectId: string;
  projectSlug: string;
}) {
  if (graph.kind === WORKBENCH_SQL_CHART_KIND) {
    return (
      <LangWatchQLDashboardWidget
        key={graph.id}
        chartId={graph.id}
        projectId={projectId}
        {...(graph.granularitySeconds == null
          ? {}
          : { granularitySeconds: graph.granularitySeconds })}
        name={graph.name}
      />
    );
  }

  if (graph.kind === DASHBOARD_SRCDOC_CHART_KIND) {
    return (
      <DashboardWidgetFrame
        key={graph.id}
        id={graph.id}
        graph={graph.graph}
        projectId={projectId}
        projectSlug={projectSlug}
        maxHeight={graph.rowSpan === 2 ? 600 : 300}
      />
    );
  }

  return (
    <CustomGraph
      key={graph.id}
      input={{
        ...(graph.graph as CustomGraphInput),
        // Height follows the card's row span.
        height: graph.rowSpan === 2 ? 600 : 300,
      }}
      filters={
        graph.filters as
          | Record<FilterField, string[] | Record<string, string[]>>
          | undefined
      }
    />
  );
}

// Re-export from GraphCardMenu for backwards compatibility
export { getCurrentSize, sizeOptions } from "./GraphCardMenu";
export type { GraphData, SizeOption };
