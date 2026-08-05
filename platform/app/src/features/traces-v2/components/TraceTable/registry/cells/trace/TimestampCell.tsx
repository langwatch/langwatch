import type React from "react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatISOTimestamp } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";
import { TimeHoverCard } from "./TimeHoverCard";

/**
 * Full ISO 8601 column ("2026-06-02T13:14:15.123Z"). For users who
 * paste timestamps into log queries / external tools and need the
 * precise wall-clock without translating from a relative string.
 * Always renders monospace so digit columns align across rows.
 */
const TimestampText: React.FC<{ timestamp: number }> = ({ timestamp }) => (
  <TimeHoverCard timestamp={timestamp}>
    <MonoCell color="fg.subtle" cursor="help">
      {formatISOTimestamp(timestamp)}
    </MonoCell>
  </TimeHoverCard>
);

export const TimestampCell = {
  id: "timestamp",
  label: "Timestamp",
  render: ({ row }) => <TimestampText timestamp={row.timestamp} />,
  renderComfortable: ({ row }) => <TimestampText timestamp={row.timestamp} />,
} as const satisfies CellDef<TraceListItem>;
