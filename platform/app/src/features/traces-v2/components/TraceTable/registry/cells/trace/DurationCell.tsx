import type { TraceListItem } from "../../../../../types/trace";
import { useTraceStatistics } from "../../../traceStatisticsContext";
import type { CellDef } from "../../types";
import { LatencyCellContent } from "./LatencyCellParts";

function DurationCellInner({
  durationMs,
  textStyle,
  textColor,
  barWidth,
  barHeight,
  gap,
}: {
  durationMs: number;
  textStyle: "mono" | "comfortable";
  textColor?: string;
  barWidth: string;
  barHeight: string;
  gap: number;
}) {
  const { p95DurationMs, hasData } = useTraceStatistics();
  return (
    <LatencyCellContent
      valueMs={durationMs}
      p95Ms={p95DurationMs}
      hasStats={hasData}
      metricPhrase="total duration"
      p95Label="p95"
      textStyle={textStyle}
      textColor={textColor}
      barWidth={barWidth}
      barHeight={barHeight}
      gap={gap}
    />
  );
}

export const DurationCell = {
  id: "duration",
  label: "Duration",
  // Both densities now let the bar fill the column width — the
  // previous fixed 40 / 56 px widths left a big gap to the right of
  // the bar that looked accidental once the column was widened or
  // resized. Full-width also gives latency-comparison reads more
  // visual resolution (a 3 % difference becomes visible instead of
  // collapsing to a 1-pixel fill delta).
  render: ({ row }) => (
    <DurationCellInner
      durationMs={row.durationMs}
      textStyle="mono"
      barWidth="100%"
      barHeight="2px"
      gap={0}
    />
  ),
  renderComfortable: ({ row }) => (
    <DurationCellInner
      durationMs={row.durationMs}
      textStyle="comfortable"
      barWidth="100%"
      barHeight="3px"
      gap={1}
    />
  ),
} as const satisfies CellDef<TraceListItem>;
