import { Box, Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import { formatDuration } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";

interface LatencyBarProps {
  valueMs: number;
  p95Ms: number;
  hasStats: boolean;
  width: string;
  height: string;
}

/**
 * Inline latency bar — scaled to the visible page's p95 instead of
 * its `max(...)`. Rows >= p95 cap the bar at full width and switch to
 * red so tail-latency outliers visually pop instead of being hidden by
 * a single bigger outlier compressing the whole column. Shared by the
 * Duration and TTFT columns, each scaling against its own p95.
 */
function LatencyBar({ valueMs, p95Ms, hasStats, width, height }: LatencyBarProps) {
  if (!hasStats || valueMs <= 0) {
    return (
      <Box
        width={width}
        height={height}
        bg="border.subtle"
        borderRadius="full"
      />
    );
  }
  const ratio = valueMs / p95Ms;
  const isOverP95 = ratio >= 1;
  const fillRatio = Math.min(ratio, 1);
  return (
    <Box
      width={width}
      height={height}
      bg="border.subtle"
      borderRadius="full"
      display="flex"
      justifyContent="flex-end"
    >
      {/* Right-anchored fill — latency columns are right-aligned, so
          the bar visually connects to the value above it rather than
          floating off to the left side of the cell. */}
      <Box
        height="full"
        width={`${fillRatio * 100}%`}
        bg={isOverP95 ? "red.fg" : "blue.fg"}
        borderRadius="full"
      />
    </Box>
  );
}

export interface LatencyCellContentProps {
  valueMs: number;
  p95Ms: number;
  hasStats: boolean;
  /**
   * Phrase placed right after the formatted value in the tooltip,
   * e.g. "total duration" or "to first token".
   */
  metricPhrase: string;
  /**
   * How the percentile is named in the tooltip, e.g. "p95" for the
   * duration column or "TTFT p95" for the TTFT column.
   */
  p95Label: string;
  textStyle: "mono" | "comfortable";
  textColor?: string;
  barWidth: string;
  barHeight: string;
  gap: number;
}

/**
 * Renders the latency value (the read at a glance), the inline bar,
 * and a tooltip that hovers over BOTH (wraps the VStack). Phrasing
 * the comparison as a percentage of p95 reads more naturally than the
 * raw multiplier — "30% of the page's p95" beats "0.3× p95".
 */
export function LatencyCellContent({
  valueMs,
  p95Ms,
  hasStats,
  metricPhrase,
  p95Label,
  textStyle,
  textColor,
  barWidth,
  barHeight,
  gap,
}: LatencyCellContentProps) {
  const ratio = hasStats && valueMs > 0 ? valueMs / p95Ms : null;
  const tooltipLabel = (() => {
    if (ratio == null) return formatDuration(valueMs);
    const pct = ratio * 100;
    const pctText = pct >= 100 ? pct.toFixed(0) : pct.toFixed(1);
    return `${formatDuration(valueMs)} ${metricPhrase} · that's ${pctText}% of the ${p95Label} of the visible traces on this page (${formatDuration(p95Ms)})`;
  })();
  return (
    <Tooltip content={tooltipLabel} positioning={{ placement: "left" }}>
      <VStack gap={gap} align="end" cursor="help" width="full">
        {textStyle === "mono" ? (
          <MonoCell>{formatDuration(valueMs)}</MonoCell>
        ) : (
          <Text textStyle="sm" color={textColor ?? "fg.muted"}>
            {formatDuration(valueMs)}
          </Text>
        )}
        <LatencyBar
          valueMs={valueMs}
          p95Ms={p95Ms}
          hasStats={hasStats}
          width={barWidth}
          height={barHeight}
        />
      </VStack>
    </Tooltip>
  );
}
