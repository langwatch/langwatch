import { Text } from "@chakra-ui/react";
import type React from "react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatVerboseRelative } from "../../../../../utils/formatters";
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
}) => (
  <TimeHoverCard timestamp={timestamp}>
    <Text
      as="span"
      textStyle={comfortable ? "sm" : "xs"}
      color="fg.muted"
      cursor="help"
      whiteSpace="nowrap"
    >
      {formatVerboseRelative(timestamp)}
    </Text>
  </TimeHoverCard>
);

export const SinceCell = {
  id: "since",
  label: "Since",
  render: ({ row }) => <SinceText timestamp={row.timestamp} />,
  renderComfortable: ({ row }) => (
    <SinceText timestamp={row.timestamp} comfortable />
  ),
} as const satisfies CellDef<TraceListItem>;
