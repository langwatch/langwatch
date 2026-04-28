import { Circle, HStack, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";

export function uniqueEventNames(rows: TraceListItem[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const evt of row.events) {
      seen.add(evt.name);
    }
  }
  return [...seen];
}

export function makeEventCellDef(name: string): CellDef<TraceListItem> {
  return {
    id: `event:${name}`,
    label: name,
    render: ({ row }) => {
      const count = row.events.filter((e) => e.name === name).length;
      if (count === 0) {
        return (
          <Text textStyle="sm" color="fg.subtle">
            —
          </Text>
        );
      }
      return (
        <HStack gap={1.5}>
          <Circle size="8px" bg="blue.solid" flexShrink={0} />
          <Text textStyle="sm" color="fg.muted">
            {count}
          </Text>
        </HStack>
      );
    },
  };
}
