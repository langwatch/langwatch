import { Box, Button, Heading, HStack, Spacer } from "@chakra-ui/react";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { BarChart2, Bell } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import type { CustomGraphInput } from "~/components/analytics/CustomGraph";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import {
  type CustomGraphFormData,
  customGraphInputToFormData,
} from "~/pages/[project]/analytics/custom/index";
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
    if (name && name.trim()) {
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

  // Create form instance from graph data for the alert drawer
  const form = useForm<CustomGraphFormData>({
    defaultValues: graph
      ? {
          ...customGraphInputToFormData(graph as CustomGraphInput),
          title: displayName,
        }
      : undefined,
  });

  // Update form title when displayName changes to keep drawer in sync
  useEffect(() => {
    if (graph) {
      form.setValue("title", displayName);
    }
  }, [displayName, form, graph]);

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
                  openDrawer("customGraphAlert", {
                    form,
                    graphId,
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
                openDrawer("customGraphAlert", {
                  form,
                  graphId,
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
