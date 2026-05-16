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
  // No useful denominator yet — render the empty track and bail.
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
  const multiplier = ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1);
  const tooltipLabel = isOverP95
    ? `${formatDuration(durationMs)} · ${multiplier}× the visible page's p95 (${formatDuration(p95DurationMs)})`
    : `${formatDuration(durationMs)} · ${multiplier}× the visible page's p95 (${formatDuration(p95DurationMs)})`;
  return (
    <Tooltip content={tooltipLabel} positioning={{ placement: "left" }}>
      <Box
        width={width}
        height={height}
        bg="border.subtle"
        borderRadius="full"
        cursor="help"
      >
        <Box
          height="full"
          width={`${fillRatio * 100}%`}
          bg={isOverP95 ? "red.fg" : "blue.fg"}
          borderRadius="full"
        />
      </Box>
    </Tooltip>
  );
}

export const DurationCell = {
  id: "duration",
  label: "Duration",
  render: ({ row }) => (
    <VStack gap={0} align="end">
      <MonoCell>{formatDuration(row.durationMs)}</MonoCell>
      <DurationBar durationMs={row.durationMs} width="40px" height="2px" />
    </VStack>
  ),
  renderComfortable: ({ row }) => (
    <VStack gap={1} align="end">
      <Text textStyle="sm" color="fg.muted">
        {formatDuration(row.durationMs)}
      </Text>
      <DurationBar durationMs={row.durationMs} width="56px" height="3px" />
    </VStack>
  ),
} as const satisfies CellDef<TraceListItem>;
