import { HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { EventBadge } from "../../sharedChips";
import type { CellDef } from "../../types";

export const EventsCell: CellDef<TraceListItem> = {
  id: "events",
  label: "Events",
  render: ({ row }) => {
    if (row.events.length === 0) {
      return (
        <Text textStyle="xs" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1} flexWrap="wrap">
        {row.events.map((evt, i) => (
          <EventBadge key={`${evt.spanId}-${i}`} event={evt} />
        ))}
      </HStack>
    );
  },
  renderComfortable: ({ row }) => {
    if (row.events.length === 0) {
      return (
        <Text textStyle="sm" color="fg.subtle">
          —
        </Text>
      );
    }
    return (
      <HStack gap={1.5} flexWrap="wrap">
        {row.events.map((evt, i) => (
          <EventBadge key={`${evt.spanId}-${i}`} event={evt} />
        ))}
      </HStack>
    );
  },
};
