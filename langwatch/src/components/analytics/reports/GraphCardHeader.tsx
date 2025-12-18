import { HStack, Spacer, Text } from "@chakra-ui/react";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { DraggableAttributes } from "@dnd-kit/core";
import { useMemo } from "react";
import { BarChart2 } from "lucide-react";
import type { FilterField } from "~/server/filters/types";
import { GraphFilterIndicator } from "./GraphFilterIndicator";
import { GraphCardMenu, type SizeOption } from "./GraphCardMenu";

interface GraphCardHeaderProps {
  graphId: string;
  name: string;
  projectSlug: string;
  colSpan: number;
  rowSpan: number;
  filters: unknown;
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
  projectSlug,
  colSpan,
  rowSpan,
  filters,
  isDragging,
  dragAttributes,
  dragListeners,
  onSizeChange,
  onDelete,
  isDeleting,
}: GraphCardHeaderProps) {
  const hasFilters = useMemo(
    () =>
      !!(filters && typeof filters === "object" && Object.keys(filters).length > 0),
    [filters]
  );

  return (
    <HStack
      {...dragAttributes}
      {...dragListeners}
      align="center"
      marginBottom={4}
      cursor={isDragging ? "grabbing" : "grab"}
    >
      <BarChart2 color="orange" />
      <Text marginLeft={2} fontSize="md" fontWeight="bold">
        {name}
      </Text>
      <Spacer />

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
        colSpan={colSpan}
        rowSpan={rowSpan}
        onSizeChange={onSizeChange}
        onDelete={onDelete}
        isDeleting={isDeleting}
      />
    </HStack>
  );
}

