import { Box, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TraceListItem } from "../../../../../types/trace";
import { formatDuration } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import { useTraceStatistics } from "../../../traceStatisticsContext";
import type { CellDef } from "../../types";

interface DurationBarProps {
  durationMs: number;
  width: string;
  height: string;
}

/**
 * Inline duration bar — scaled to the visible page's p95 instead of
 * its `max(...)`. Rows >= p95 cap the bar at full width and switch to
 * red so tail-latency outliers visually pop instead of being hidden by
 * a single bigger outlier compressing the whole column.
 */
function DurationBar({ durationMs, width, height }: DurationBarProps) {
  const { p95DurationMs, hasData } = useTraceStatistics();
  if (!hasData || durationMs <= 0) {
    return (
      <Box
        width={width}
        height={height}
        bg="border.subtle"
        borderRadius="full"
      />
    );
  }
  const ratio = durationMs / p95DurationMs;
  const isOverP95 = ratio >= 1;
  const fillRatio = Math.min(ratio, 1);
  return (
    <Box
      width={width}
      height={height}
      bg="border.subtle"
      borderRadius="full"
    >
      <Box
        height="full"
        width={`${fillRatio * 100}%`}
        bg={isOverP95 ? "red.fg" : "blue.fg"}
        borderRadius="full"
      />
    </Box>
  );
}

/**
 * Renders the duration value (the read at a glance), the inline bar,
 * and a tooltip that hovers over BOTH (wraps the VStack). Phrasing
 * the comparison as a percentage of p95 reads more naturally than the
 * raw multiplier — "30% of the page's p95" beats "0.3× p95".
 */
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
  const ratio = hasData && durationMs > 0 ? durationMs / p95DurationMs : null;
  const tooltipLabel = (() => {
    if (ratio == null) return formatDuration(durationMs);
    const pct = ratio * 100;
    const pctText = pct >= 100 ? pct.toFixed(0) : pct.toFixed(1);
    return `${formatDuration(durationMs)} total duration · that's ${pctText}% of the p95 of the visible traces on this page (${formatDuration(p95DurationMs)})`;
  })();
  return (
    <Tooltip content={tooltipLabel} positioning={{ placement: "left" }}>
      <VStack gap={gap} align="end" cursor="help" width="full">
        {textStyle === "mono" ? (
          <MonoCell>{formatDuration(durationMs)}</MonoCell>
        ) : (
          <Text textStyle="sm" color={textColor ?? "fg.muted"}>
            {formatDuration(durationMs)}
          </Text>
        )}
        <DurationBar
          durationMs={durationMs}
          width={barWidth}
          height={barHeight}
        />
      </VStack>
    </Tooltip>
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
