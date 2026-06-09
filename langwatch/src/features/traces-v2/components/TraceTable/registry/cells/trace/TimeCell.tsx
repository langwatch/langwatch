import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatRelativeTime } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";
import { TimeHoverCard } from "./TimeHoverCard";

// Compact TIME / SINCE / TIMESTAMP all share the same TimeHoverCard so
// hovering any time cell surfaces the full breakdown (verbose relative,
// local + tz, UTC, ISO). Previously this column used a flat Tooltip
// that showed only the UTC string — the user couldn't see local time,
// tz, or ISO without switching columns.
export const TimeCell = {
  id: "time",
  label: "Time",
  render: ({ row, isExpanded, actions }) => (
    <HStack gap={1}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <TimeHoverCard timestamp={row.timestamp}>
        <MonoCell color="fg.subtle" cursor="help">
          {formatRelativeTime(row.timestamp)}
        </MonoCell>
      </TimeHoverCard>
    </HStack>
  ),
  renderComfortable: ({ row, isExpanded, actions }) => (
    <HStack gap={2}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <TimeHoverCard timestamp={row.timestamp}>
        <Text textStyle="sm" color="fg.muted" cursor="help">
          {formatRelativeTime(row.timestamp)}
        </Text>
      </TimeHoverCard>
    </HStack>
  ),
} as const satisfies CellDef<TraceListItem>;

const PeekButton: React.FC<{
  isExpanded: boolean;
  onClick: () => void;
}> = ({ isExpanded, onClick }) => (
  <Box
    as="button"
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    }}
    display="flex"
    alignItems="center"
    justifyContent="center"
    flexShrink={0}
    width="16px"
    height="16px"
    borderRadius="sm"
    color={isExpanded ? "fg" : "fg.subtle/50"}
    _hover={{ color: "fg", bg: "fg.subtle/10" }}
    transition="color 0.1s"
  >
    <Icon boxSize="12px">
      {isExpanded ? <ChevronDown /> : <ChevronRight />}
    </Icon>
  </Box>
);
