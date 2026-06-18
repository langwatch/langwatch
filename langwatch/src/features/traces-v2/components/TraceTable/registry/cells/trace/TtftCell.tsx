import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { MonoCell } from "../../../MonoCell";
import { useTraceStatistics } from "../../../traceStatisticsContext";
import type { CellDef } from "../../types";
import { dash } from "../dashPlaceholder";
import { LatencyCellContent } from "./LatencyCellParts";

function TtftCellInner({
  ttftMs,
  textStyle,
  barWidth,
  barHeight,
  gap,
}: {
  ttftMs: number;
  textStyle: "mono" | "comfortable";
  barWidth: string;
  barHeight: string;
  gap: number;
}) {
  const { p95TtftMs, hasTtftData } = useTraceStatistics();
  return (
    <LatencyCellContent
      valueMs={ttftMs}
      p95Ms={p95TtftMs}
      hasStats={hasTtftData}
      metricPhrase="to first token"
      p95Label="TTFT p95"
      textStyle={textStyle}
      barWidth={barWidth}
      barHeight={barHeight}
      gap={gap}
    />
  );
}

/**
 * Time-to-first-token column. Mirrors the Duration column's p95-scaled
 * bar so streaming latency outliers pop the same way slow traces do —
 * but scaled against the page's TTFT p95, not the duration p95.
 * Traces without a TTFT (non-streaming, or instrumentation that never
 * reported one) render a plain dash with no bar.
 */
export const TtftCell = {
  id: "ttft",
  label: "TTFT",
  render: ({ row }) =>
    row.ttft != null ? (
      <TtftCellInner
        ttftMs={row.ttft}
        textStyle="mono"
        barWidth="100%"
        barHeight="2px"
        gap={0}
      />
    ) : (
      <MonoCell>{dash}</MonoCell>
    ),
  renderComfortable: ({ row }) =>
    row.ttft != null ? (
      <TtftCellInner
        ttftMs={row.ttft}
        textStyle="comfortable"
        barWidth="100%"
        barHeight="3px"
        gap={1}
      />
    ) : (
      <Text textStyle="sm" color="fg.muted" textAlign="right">
        {dash}
      </Text>
    ),
} as const satisfies CellDef<TraceListItem>;
