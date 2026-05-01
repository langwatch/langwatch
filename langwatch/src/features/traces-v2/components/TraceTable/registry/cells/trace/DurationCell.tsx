import { Box, Text, VStack } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatDuration } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

const MAX_DURATION_MS = 25_000;

export const DurationCell = {
  id: "duration",
  label: "Duration",
  render: ({ row }) => {
    const ratio = Math.min(row.durationMs / MAX_DURATION_MS, 1);
    return (
      <VStack gap={0} align="end">
        <MonoCell>{formatDuration(row.durationMs)}</MonoCell>
        <Box width="40px" height="2px" bg="border.subtle" borderRadius="full">
          <Box
            height="full"
            width={`${ratio * 100}%`}
            bg="blue.fg"
            borderRadius="full"
          />
        </Box>
      </VStack>
    );
  },
  renderComfortable: ({ row }) => {
    const ratio = Math.min(row.durationMs / MAX_DURATION_MS, 1);
    return (
      <VStack gap={1} align="end">
        <Text textStyle="sm" color="fg.muted" fontFamily="mono">
          {formatDuration(row.durationMs)}
        </Text>
        <Box width="56px" height="3px" bg="border.subtle" borderRadius="full">
          <Box
            height="full"
            width={`${ratio * 100}%`}
            bg="blue.fg"
            borderRadius="full"
          />
        </Box>
      </VStack>
    );
  },
} as const satisfies CellDef<TraceListItem>;
