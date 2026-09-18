import { Heading, HStack, Spacer } from "@chakra-ui/react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BarChart2 } from "lucide-react";
import { useMemo } from "react";

import type { FilterField } from "../../model/analytics-filter-definition.ts";
import { GraphFilterIndicator } from "../elements/graph-filter-indicator.tsx";
import type { CustomGraphInput } from "./custom-graph.tsx";
import { GraphCardMenu } from "./graph-card-menu.tsx";

interface GraphCardHeaderProps {
  graphId: string;
  name: string;
  graph: unknown;
  projectId: string;
  projectSlug: string;
  dashboardId?: string;
  filters: unknown;
  /** Whether this card is a saved LangWatchQL chart rather than a builder graph. */
  isWorkbenchChart?: boolean;
  /** The datapoint step a workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
  /** Optional drag affordances for sortable lists; the dashboard grid supplies its own handle. */
  isDragging?: boolean;
  dragAttributes?: DraggableAttributes;
  dragListeners?: SyntheticListenerMap;
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
  isWorkbenchChart = false,
  granularitySeconds,
  isDragging,
  dragAttributes,
  dragListeners,
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
    if (graph && typeof graph === "object" && "series" in graph) {
      const graphInput = graph as CustomGraphInput;
      if (graphInput.series && graphInput.series.length > 0) {
        const seriesNames = graphInput.series
          .map((s) => s.name)
          .filter(Boolean)
          .join(", ");
        if (seriesNames) {
          return seriesNames.replace(/,([^,]*)$/, " and$1");
        }
      }
    }

    return "Untitled Graph";
  }, [name, graph]);

  const hasFilters = useMemo(
    () => !!(filters && typeof filters === "object" && Object.keys(filters).length > 0),
    [filters],
  );

  /**
   * THE ALERT BELL DID NOT TRAVEL, and this is the second of the two places it stopped being a
   * compile break. Both entry points — "Add alert" and the bell that edits an existing one —
   * called `openDrawer("automation", …)`.
   */

  return (
    <HStack
      {...dragAttributes}
      {...dragListeners}
      align="center"
      marginBottom={4}
      cursor={isDragging ? "grabbing" : "grab"}
    >
      <BarChart2 color="orange" />
      <Heading size="sm" marginLeft={2}>
        {displayName}
      </Heading>
      <Spacer />

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
        {...(granularitySeconds === undefined ? {} : { granularitySeconds })}
        {...(onGranularityChange ? { onGranularityChange } : {})}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}
