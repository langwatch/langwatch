import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { useTimeFormatStore } from "../../../../../stores/timeFormatStore";
import type { TraceListItem } from "../../../../../types/trace";
import { formatISOTimestamp } from "../../../../../utils/formatters";
import { useRelativeTime } from "../../../../../utils/useRelativeTime";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";
import { TimeHoverCard } from "./TimeHoverCard";

// The pinned Time column renders either compact relative ("3m") or full
// ISO 8601, per the user's `timeFormatStore` choice (switchable from the
// column picker). Both share the same TimeHoverCard so hovering surfaces
// the full breakdown (verbose relative, local + tz, UTC, ISO) regardless
// of the chosen format.
export const TimeCell = {
  id: "time",
  label: "Time",
  render: ({ row, isExpanded, actions }) => (
    <HStack gap={1}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <TimeHoverCard timestamp={row.timestamp}>
        <TimeValue timestamp={row.timestamp} density="compact" />
      </TimeHoverCard>
    </HStack>
  ),
  renderComfortable: ({ row, isExpanded, actions }) => (
    <HStack gap={2}>
      {actions.onTogglePeek && (
        <PeekButton isExpanded={isExpanded} onClick={actions.onTogglePeek} />
      )}
      <TimeHoverCard timestamp={row.timestamp}>
        <TimeValue timestamp={row.timestamp} density="comfortable" />
      </TimeHoverCard>
    </HStack>
  ),
} as const satisfies CellDef<TraceListItem>;

/**
 * The pinned Time column's value. ISO always renders monospace (digit
 * columns align across rows); relative uses the muted MonoCell in compact
 * and a softer Text in comfortable, matching the prior look.
 */
const TimeValue: React.FC<{
  timestamp: number;
  density: "compact" | "comfortable";
}> = ({ timestamp, density }) => {
  const format = useTimeFormatStore((s) => s.format);
  if (format === "iso") {
    return (
      <MonoCell color="fg.subtle" cursor="help">
        {formatISOTimestamp(timestamp)}
      </MonoCell>
    );
  }
  if (density === "comfortable") {
    return (
      <Text textStyle="sm" color="fg.muted" cursor="help">
        <CompactRelative timestamp={timestamp} />
      </Text>
    );
  }
  return (
    <MonoCell color="fg.subtle" cursor="help">
      <CompactRelative timestamp={timestamp} />
    </MonoCell>
  );
};

/**
 * Compact relative time ("4m"), self-updating at the next label
 * boundary. Extracted as a component so the hook isolation is per-row;
 * the surrounding cell renderers stay pure functions.
 */
const CompactRelative: React.FC<{ timestamp: number }> = ({ timestamp }) => {
  const relative = useRelativeTime(timestamp);
  return <>{relative}</>;
};

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
