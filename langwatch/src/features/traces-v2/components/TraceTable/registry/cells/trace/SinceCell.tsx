import { Text } from "@chakra-ui/react";
import type React from "react";
import { useTimeColumnModeStore } from "../../../../../stores/timeColumnModeStore";
import type { TraceListItem } from "../../../../../types/trace";
import { formatCompactAbsolute } from "../../../../../utils/formatters";
import { useVerboseRelativeTime } from "../../../../../utils/useRelativeTime";
import type { CellDef } from "../../types";
import { TimeHoverCard } from "./TimeHoverCard";

/**
 * Verbose relative-time column ("1 minute ago", "3 hours ago", "7 days
 * ago"). Sibling to the compact TIME column — the user picks one or the
 * other from the column dropdown. The hover surfaces the full date /
 * tz / ISO breakdown via the shared TimeHoverCard.
 */
const SinceText: React.FC<{ timestamp: number; comfortable?: boolean }> = ({
  timestamp,
  comfortable,
}) => {
  // Self-updates at the next minute / hour / day boundary so a row
  // open through a tick reads "4 minutes ago" once the wall clock
  // crosses 4*60_000ms past the trace, not "3 minutes ago" until the
  // next render. When the column mode is "absolute", switch to a
  // compact local-time form instead.
  const mode = useTimeColumnModeStore((s) => s.mode);
  const relative = useVerboseRelativeTime(timestamp);
  const label =
    mode === "absolute" ? formatCompactAbsolute(timestamp) : relative;
  return (
    <TimeHoverCard timestamp={timestamp}>
      <Text
        as="span"
        textStyle={comfortable ? "sm" : "xs"}
        color="fg.muted"
        cursor="help"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
    </TimeHoverCard>
  );
};

export const SinceCell = {
  id: "since",
  label: "Since",
  render: ({ row }) => <SinceText timestamp={row.timestamp} />,
  renderComfortable: ({ row }) => (
    <SinceText timestamp={row.timestamp} comfortable />
  ),
} as const satisfies CellDef<TraceListItem>;
