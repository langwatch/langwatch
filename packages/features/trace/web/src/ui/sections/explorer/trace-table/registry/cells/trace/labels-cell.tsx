import { Badge, HStack, Text } from "@chakra-ui/react";
import { useFilterStore } from "../../../../../../../index";
import { getColorPaletteForString } from "../../../../../../../model/rotating-colors";
import type { TraceListItem } from "../../../../types/trace";
import type { CellDef } from "../../types";
import { FilterChip } from "../../../../../../blocks/explorer/trace-table/registry/cells/filter-chip";

type Density = "compact" | "comfortable";

/**
 * Trace-level labels rendered as colour-coded badges — the v2 successor to the old
 * messages table's Labels column. Each label's hue is derived from its text via
 * `getColorPaletteForString` so the same label reads the same colour across every row.
 */
function renderLabels({ row, density }: { row: TraceListItem; density: Density }) {
  // Defensive default: a row that bypassed `mapTraceListPayload` (cached
  // legacy payload, optimistic placeholder) can arrive without `labels`.
  const labels = row.labels ?? [];
  if (labels.length === 0) {
    return (
      <Text textStyle={density === "compact" ? "xs" : "sm"} color="fg.subtle">
        —
      </Text>
    );
  }
  return (
    <HStack gap={1} flexWrap="wrap">
      {labels.map((label) => (
        <FilterChip
          key={label}
          onFilter={() => useFilterStore.getState().toggleFacet("label", label)}
          filterLabel={`Filter by label "${label}"`}
        >
          <Badge
            size={density === "compact" ? "xs" : "sm"}
            variant="surface"
            colorPalette={getColorPaletteForString(label)}
            paddingX={2}
          >
            {label}
          </Badge>
        </FilterChip>
      ))}
    </HStack>
  );
}

export const LabelsCell = {
  id: "labels",
  label: "Labels",
  render: ({ row }) => renderLabels({ row, density: "compact" }),
  renderComfortable: ({ row }) => renderLabels({ row, density: "comfortable" }),
} as const satisfies CellDef<TraceListItem>;
