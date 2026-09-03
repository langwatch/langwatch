import { Box, Button, Heading, HStack, Spacer } from "@chakra-ui/react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BarChart2 } from "lucide-react";
import { useMemo } from "react";
import type { CustomGraphInput } from "./custom-graph";
import type { FilterField } from "../../model/analytics-filter-definition";
import { GraphCardMenu, type SizeOption } from "./graph-card-menu";
import { GraphFilterIndicator } from "../elements/graph-filter-indicator";

interface GraphCardHeaderProps {
  graphId: string;
  name: string;
  graph: unknown;
  projectSlug: string;
  dashboardId?: string;
  colSpan: number;
  rowSpan: number;
  filters: unknown;
  /** Whether this card is a saved LangWatchQL chart rather than a builder graph. */
  isWorkbenchChart?: boolean;
  /** The datapoint step a workbench card runs at, when it has one stored. */
  granularitySeconds?: number;
  isDragging: boolean;
  dragAttributes: DraggableAttributes;
  dragListeners: SyntheticListenerMap | undefined;
  onSizeChange: (size: SizeOption) => void;
  onGranularityChange?: (granularitySeconds: number) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardHeader({
  graphId,
  name,
  graph,
  projectSlug,
  dashboardId,
  colSpan,
  rowSpan,
  filters,
  isWorkbenchChart = false,
  granularitySeconds,
  isDragging,
  dragAttributes,
  dragListeners,
  onSizeChange,
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
   * THE ALERT BELL DID NOT TRAVEL, and this is the second of the two places it
   * stopped being a compile break.
   *
   * Both entry points — "Add alert" and the bell that edits an existing one —
   * called `openDrawer("automation", …)`. That registry entry was DELETED when
   * the automations family moved out of `platform/app`, so these two call sites
   * have not compiled since; they are two of the seven breaks that move
   * recorded, and deleting this header retires them.
   *
   * Reinstating them means a cross-feature overlay capability that does not
   * exist yet: authoring an alert is `@langwatch/automation-web`'s drawer, a
   * web package may not import another web package, and the chrome layout route
   * that would mount a registry for a packaged screen is separate work. The
   * alerts themselves are untouched — every one already authored still fires,
   * and the automations pages still edit them; what is gone is the shortcut
   * from a chart to its alert. RECORDED, so whoever lands the overlay
   * capability knows this is one of its first customers.
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
        projectSlug={projectSlug}
        dashboardId={dashboardId}
        colSpan={colSpan}
        rowSpan={rowSpan}
        isWorkbenchChart={isWorkbenchChart}
        {...(granularitySeconds === undefined ? {} : { granularitySeconds })}
        onSizeChange={onSizeChange}
        {...(onGranularityChange ? { onGranularityChange } : {})}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}
