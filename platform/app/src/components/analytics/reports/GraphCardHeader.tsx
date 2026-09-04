import { Box, Button, Heading, HStack, Spacer } from "@chakra-ui/react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BarChart2, Bell } from "lucide-react";
import { useMemo } from "react";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { deriveSeriesIdentifier } from "~/components/analytics/seriesIdentifier";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterField } from "~/server/filters/types";
import { GraphCardMenu, type SizeOption } from "./GraphCardMenu";
import { GraphFilterIndicator } from "./GraphFilterIndicator";

interface GraphCardHeaderProps {
  graphId: string;
  name: string;
  graph: unknown;
  projectSlug: string;
  dashboardId?: string;
  colSpan: number;
  rowSpan: number;
  filters: unknown;
  trigger?: {
    id: string;
    active: boolean;
    alertType: string | null;
  } | null;
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
  trigger,
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
  const { openDrawer } = useDrawer();

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

  // The dashboard chart doesn't expose an interactive "currently selected
  // series" — every series is rendered together. Default the alert author
  // to the first series and let them switch inside the drawer if they want
  // a different one. Encoded in the canonical id format the threshold
  // dispatcher reads.
  const defaultSeriesName = useMemo(
    () => deriveSeriesIdentifier(graph, 0),
    [graph],
  );

  const hasFilters = useMemo(
    () =>
      !!(
        filters &&
        typeof filters === "object" &&
        Object.keys(filters).length > 0
      ),
    [filters],
  );

  // Check if this is a saved graph (has valid database ID).
  //
  // A workbench chart is excluded on purpose rather than by accident: the alert
  // path reads a builder payload's `series` to name what it is thresholding,
  // and a saved statement has no series to read. Offering the bell here would
  // author an alert against a chart the threshold dispatcher cannot evaluate.
  const isSavedGraph =
    !isWorkbenchChart && !!(graphId && graphId !== "custom" && graph);

  // Opens the automations drawer in edit mode for this graph's existing
  // trigger. Shared by the bell's click and keyboard handlers so both entry
  // points stay identical.
  const openEditAutomation = () => {
    if (!trigger) return;
    openDrawer("automation", {
      automationId: trigger.id,
      prefilledGraphId: graphId,
      prefilledSeriesName: defaultSeriesName,
    });
  };

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

      {isSavedGraph && (
        <>
          {/*
           * Add-automation / edit-automation entry points for this graph.
           *
           * Both buttons open the automations drawer (the unified
           * authoring flow introduced in Phase 5.1 of ADR-034) pre-filled
           * with this chart's graphId + series; the bell additionally
           * passes `automationId` so the drawer hydrates the existing
           * trigger row in edit mode. The legacy `customGraphAlert`
           * drawer and its registry entry were removed in this PR — the
           * automations drawer is the only alert-authoring path.
           */}
          {trigger?.active ? (
            <Tooltip
              content="Edit automation"
              positioning={{ placement: "top" }}
              showArrow
            >
              <Box
                role="button"
                aria-label="Edit automation"
                tabIndex={0}
                padding={1}
                cursor="pointer"
                color="fg"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditAutomation();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    openEditAutomation();
                  }
                }}
              >
                <Bell width={18} />
              </Box>
            </Tooltip>
          ) : (
            <Button
              variant="outline"
              colorPalette="gray"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openDrawer("automation", {
                  prefilledGraphId: graphId,
                  prefilledSeriesName: defaultSeriesName,
                });
              }}
            >
              <Bell width={16} />
              Add automation
            </Button>
          )}
        </>
      )}

      {hasFilters && (
        <GraphFilterIndicator
          filters={
            filters as Record<FilterField, string[] | Record<string, string[]>>
          }
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
