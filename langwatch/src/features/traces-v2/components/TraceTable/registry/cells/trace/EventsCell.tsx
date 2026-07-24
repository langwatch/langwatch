import { HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { EventBadge } from "../../sharedChips";
import type { CellDef } from "../../types";

type Density = "compact" | "comfortable";

function renderEvents(row: TraceListItem, density: Density) {
  const textStyle = density === "compact" ? "xs" : "sm";
  if (row.events.length === 0) {
    return (
      <Text textStyle={textStyle} color="fg.subtle">
        —
      </Text>
    );
  }
  const gap = density === "compact" ? 1 : 1.5;
  return (
    <HStack gap={gap} flexWrap="wrap">
      {row.events.map((evt, i) => (
        <EventBadge key={`${evt.spanId}-${i}`} event={evt} />
      ))}
    </HStack>
  );
}

export const EventsCell = {
  id: "events",
  label: "Events",
  render: ({ row }) => renderEvents(row, "compact"),
  renderComfortable: ({ row }) => renderEvents(row, "comfortable"),
} as const satisfies CellDef<TraceListItem>;
