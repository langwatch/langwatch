import {
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/router";
import { useMemo } from "react";
import {
  BarChart2,
  Edit,
  Filter,
  Grid,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { CustomGraph, type CustomGraphInput } from "~/components/analytics/CustomGraph";
import { FilterDisplay } from "~/components/triggers/FilterDisplay";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import type { FilterField } from "~/server/filters/types";

type SizeOption = "1x1" | "2x1" | "1x2" | "2x2";

interface GraphData {
  id: string;
  name: string;
  graph: unknown;
  filters: unknown;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

interface DraggableGraphCardProps {
  graph: GraphData;
  projectSlug: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
  isDeleting: boolean;
}

const sizeOptions: { value: SizeOption; label: string; colSpan: number; rowSpan: number }[] = [
  { value: "1x1", label: "Small (1x1)", colSpan: 1, rowSpan: 1 },
  { value: "2x1", label: "Wide (2x1)", colSpan: 2, rowSpan: 1 },
  { value: "1x2", label: "Tall (1x2)", colSpan: 1, rowSpan: 2 },
  { value: "2x2", label: "Large (2x2)", colSpan: 2, rowSpan: 2 },
];

function getCurrentSize(colSpan: number, rowSpan: number): SizeOption {
  if (colSpan === 2 && rowSpan === 2) return "2x2";
  if (colSpan === 2 && rowSpan === 1) return "2x1";
  if (colSpan === 1 && rowSpan === 2) return "1x2";
  return "1x1";
}

export function DraggableGraphCard({
  graph,
  projectSlug,
  onDelete,
  onSizeChange,
  isDeleting,
}: DraggableGraphCardProps) {
  const router = useRouter();

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

  const hasFilters = useMemo(
    () =>
      !!(
        graph.filters &&
        typeof graph.filters === "object" &&
        Object.keys(graph.filters).length > 0
      ),
    [graph.filters],
  );

  const currentSize = getCurrentSize(graph.colSpan, graph.rowSpan);

  // Calculate height based on rowSpan
  const graphHeight = graph.rowSpan === 2 ? 600 : 300;

  return (
    <Box ref={setNodeRef} style={style} minWidth={0}>
      <Card.Root height="full" minWidth={0}>
        <Card.Body height="full" display="flex" flexDirection="column" minWidth={0} overflow="hidden">
          {/* Draggable header area */}
          <HStack
            {...attributes}
            {...listeners}
            align="center"
            marginBottom={4}
            cursor={isDragging ? "grabbing" : "grab"}
          >
            <BarChart2 color="orange" />
            <Text marginLeft={2} fontSize="md" fontWeight="bold">
              {graph.name}
            </Text>
            <Spacer />

            {hasFilters && (
              <Tooltip
                content={
                  <VStack
                    align="start"
                    backgroundColor="black"
                    color="white"
                    height="100%"
                    textWrap="wrap"
                  >
                    <FilterDisplay
                      filters={
                        graph.filters as Record<
                          FilterField,
                          string[] | Record<string, string[]>
                        >
                      }
                    />
                  </VStack>
                }
                positioning={{ placement: "top" }}
                showArrow
              >
                <Box padding={1}>
                  <Filter width={16} style={{ minWidth: 16 }} />
                </Box>
              </Tooltip>
            )}

            <Menu.Root>
              <Menu.Trigger asChild>
                <Button variant="ghost" loading={isDeleting}>
                  <MoreVertical />
                </Button>
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item
                  value="edit"
                  onClick={() => {
                    void router.push(
                      `/${projectSlug}/analytics/custom/${graph.id}`,
                    );
                  }}
                >
                  <Edit /> Edit Graph
                </Menu.Item>

                {/* Size submenu */}
                <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
                  <Menu.TriggerItem value="size">
                    <Grid /> Size ({currentSize})
                  </Menu.TriggerItem>
                  <Menu.Content>
                    {sizeOptions.map((option) => (
                      <Menu.Item
                        key={option.value}
                        value={option.value}
                        onClick={() => onSizeChange(option.value)}
                      >
                        {option.label}
                        {option.value === currentSize && " ✓"}
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Root>

                <Menu.Item value="delete" color="red.600" onClick={onDelete}>
                  <Trash2 /> Delete Graph
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          </HStack>

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

// Export size utilities for use in parent components
export { sizeOptions, getCurrentSize };
export type { SizeOption, GraphData };
