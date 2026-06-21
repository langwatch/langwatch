import { Box, Button, Heading, HStack, Spacer } from "@chakra-ui/react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BarChart2, Bell } from "lucide-react";
import { useMemo } from "react";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterField } from "~/server/filters/types";
import { GraphCardMenu, type SizeOption } from "./GraphCardMenu";
import { GraphFilterIndicator } from "./GraphFilterIndicator";

/**
 * Encodes a graph series into the canonical `"{index}/{key|metric}/{aggregation}"`
 * identifier the automations drawer + dispatcher both key off of. The
 * `name` field on `Series` is a human label ("p95 latency"), not what the
 * threshold rule stores, so we have to derive the identifier from the same
 * fields `FiltersSecondaryDrawer.deriveSeriesOptionsFromGraph` reads.
 */
function deriveSeriesIdentifier(
  graph: unknown,
  index: number,
): string | undefined {
  if (!graph || typeof graph !== "object") return undefined;
  const candidate = (graph as { series?: unknown }).series;
  if (!Array.isArray(candidate)) return undefined;
  const entry = candidate[index];
  if (!entry || typeof entry !== "object") return undefined;
  const s = entry as Record<string, unknown>;
  const keyPart =
    typeof s.key === "string" && s.key.length > 0
      ? s.key
      : typeof s.metric === "string"
        ? s.metric
        : "value";
  const aggregationPart =
    typeof s.aggregation === "string" ? s.aggregation : "count";
  return `${index}/${keyPart}/${aggregationPart}`;
}

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
  isDragging: boolean;
  dragAttributes: DraggableAttributes;
  dragListeners: SyntheticListenerMap | undefined;
  onSizeChange: (size: SizeOption) => void;
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
  isDragging,
  dragAttributes,
  dragListeners,
  onSizeChange,
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

  // Check if this is a saved graph (has valid database ID)
  const isSavedGraph = !!(graphId && graphId !== "custom" && graph);

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
           * Add-alert / edit-alert entry points for this graph.
           *
           * Both buttons open the automations drawer (the unified alert-
           * authoring flow introduced in Phase 5.1 of ADR-034) pre-filled
           * with this chart's graphId + series; the bell additionally
           * passes `automationId` so the drawer hydrates the existing
           * trigger row in edit mode. The legacy `customGraphAlert`
           * drawer is kept in the registry as an unreachable fallback per
           * the side-by-side rollout decision in ADR-034.
           */}
          {trigger?.active ? (
            <Tooltip
              content={`Alert configured (${trigger.alertType ?? "INFO"})`}
              positioning={{ placement: "top" }}
              showArrow
            >
              <Box
                padding={1}
                cursor="pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  openDrawer("automation", {
                    automationId: trigger.id,
                    prefilledGraphId: graphId,
                    prefilledSeriesName: defaultSeriesName,
                  });
                }}
              >
                <Bell width={18} color="black" />
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
              Add alert
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
        onSizeChange={onSizeChange}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}
