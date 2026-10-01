import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { findSeriesIdentifier } from "@langwatch/automation-contract";
import { customGraphInputSchema } from "@langwatch/dashboard-contract";
import { Button, Heading, HStack, IconButton, Spacer } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { BarChart2, Bell } from "lucide-react";
import { useMemo, type MouseEvent } from "react";

import type { FilterField } from "../../model/analytics-filter-definition.ts";
import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { GraphFilterIndicator } from "../elements/graph-filter-indicator.tsx";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "./chart-grid.tsx";
import { EditableWidgetName } from "./editable-widget-name.tsx";
import { GraphCardMenu } from "./graph-card-menu.tsx";

type GraphCardTrigger = { id: string; active: boolean; alertType: string | null };

/** Main's add/edit automation entry points; both open automation's drawer through the host. */
function GraphCardAlertButton({
  graphId,
  graph,
  trigger,
}: {
  graphId: string;
  graph: unknown;
  trigger?: GraphCardTrigger | null;
}) {
  const host = useAnalyticsHost();
  const openAlert = (event: MouseEvent) => {
    event.stopPropagation();
    const seriesName = findSeriesIdentifier(graph, 0);
    host.openAutomationDrawer({
      graphId,
      ...(trigger?.active ? { automationId: trigger.id } : {}),
      ...(seriesName === undefined ? {} : { seriesName }),
    });
  };

  if (trigger?.active) {
    return (
      <Tooltip content="Edit automation" positioning={{ placement: "top" }} showArrow>
        <IconButton
          aria-label="Edit automation"
          variant="ghost"
          size="sm"
          color="fg"
          onClick={openAlert}
        >
          <Bell width={18} />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Button variant="outline" colorPalette="gray" size="sm" onClick={openAlert}>
      <Bell width={16} />
      Add automation
    </Button>
  );
}

interface GraphCardHeaderProps {
  graphId: string;
  name: string;
  graph: unknown;
  projectId: string;
  projectSlug: string;
  dashboardId?: string;
  filters: unknown;
  /** The alert already authored on this graph, if any. */
  trigger?: GraphCardTrigger | null;
  /** Whether this card is a saved LangWatchQL chart rather than a builder graph. */
  isWorkbenchChart?: boolean;
  /** Whether this card is a dashboard widget, which has no `series` to alert on either. */
  isDashboardWidget?: boolean;
  /** The datapoint step a workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
  /** Optional drag affordances for sortable lists; the dashboard grid supplies its own handle. */
  isDragging?: boolean;
  dragAttributes?: DraggableAttributes;
  dragListeners?: SyntheticListenerMap;
  /** When present, the menu's Edit runs this in place instead of navigating away. */
  onEdit?: () => void;
  /** Renames a dashboard widget from its title; builder titles stay plain text. */
  onRename?: (name: string) => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardHeader({
  graphId,
  name,
  graph,
  projectId,
  projectSlug,
  dashboardId,
  filters,
  trigger,
  isWorkbenchChart = false,
  isDashboardWidget = false,
  granularitySeconds,
  isDragging,
  dragAttributes,
  dragListeners,
  onEdit,
  onRename,
  onGranularityChange,
  onDelete,
  isDeleting,
}: GraphCardHeaderProps) {
  // Generate fallback title from graph series if name is missing
  const displayName = useMemo(() => {
    if (name?.trim()) {
      return name;
    }

    // Try to generate a title from the graph data
    const graphInput = customGraphInputSchema.safeParse(graph);
    const seriesNames = graphInput.success
      ? graphInput.data.series
          .map((s) => s.name)
          .filter(Boolean)
          .join(", ")
      : "";
    if (seriesNames) {
      return seriesNames.replace(/,([^,]*)$/, " and$1");
    }

    return "Untitled Graph";
  }, [name, graph]);

  const hasFilters = useMemo(
    () => !!(filters && typeof filters === "object" && Object.keys(filters).length > 0),
    [filters],
  );

  // Neither a workbench chart nor a dashboard widget has a builder `series` to threshold.
  const isSavedGraph =
    !isWorkbenchChart && !isDashboardWidget && !!(graphId && graphId !== "custom" && graph);

  return (
    // The header is the card's drag handle: the grid only starts a move from this class.
    <HStack
      className={CHART_GRID_DRAG_HANDLE_CLASS}
      {...dragAttributes}
      {...dragListeners}
      align="center"
      marginBottom={4}
      cursor={isDragging ? "grabbing" : "grab"}
    >
      <BarChart2 color="orange" />
      {isDashboardWidget && onRename ? (
        <EditableWidgetName
          name={displayName}
          id={graphId}
          onRename={onRename}
          fontSize="sm"
          fontWeight="bold"
          shouldTruncate
        />
      ) : (
        <Heading size="sm" marginLeft={2}>
          {displayName}
        </Heading>
      )}
      <Spacer />

      {isSavedGraph && <GraphCardAlertButton graphId={graphId} graph={graph} trigger={trigger} />}

      {hasFilters && (
        <GraphFilterIndicator
          filters={filters as Record<FilterField, string[] | Record<string, string[]>>}
        />
      )}

      <GraphCardMenu
        graphId={graphId}
        projectId={projectId}
        projectSlug={projectSlug}
        dashboardId={dashboardId}
        isWorkbenchChart={isWorkbenchChart}
        isDashboardWidget={isDashboardWidget}
        {...(onEdit ? { onEdit } : {})}
        {...(granularitySeconds === undefined ? {} : { granularitySeconds })}
        {...(onGranularityChange ? { onGranularityChange } : {})}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}
