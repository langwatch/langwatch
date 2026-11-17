/**
 * One bar per day, each as tall as its share of the busiest day, with a few axis labels under it.
 * A day with nothing draws no bar; a small day keeps a sliver so it still shows. Hover names the
 * day. Spec: specs/daily-bar-chart.feature.
 */
import { Box, HStack, Text, VStack, VisuallyHidden } from "@chakra-ui/react";

/** One day. `title` is what hover shows: "3 Nov: 4,800 events". */
export interface DailyBar {
  value: number;
  title: string;
}

export interface DailyBarChartProps {
  bars: readonly DailyBar[];
  /** Labels spread evenly under the bars: the first, middle and last day. */
  axis: readonly string[];
  /** What a screen reader hears in place of the bars. */
  summary: string;
  /** Height of the bar area. */
  height?: string;
  colorPalette?: string;
  "data-testid"?: string;
}

const SMALLEST_VISIBLE_SHARE = 0.04;

/** Each bar's height as a share of the busiest, 0 for a bar with nothing. */
export function dailyBarShares(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((value) =>
    max > 0 && value > 0 ? Math.max(SMALLEST_VISIBLE_SHARE, value / max) : 0,
  );
}

export function DailyBarChart({
  bars,
  axis,
  summary,
  height = "96px",
  colorPalette = "orange",
  "data-testid": testId = "daily-bar-chart",
}: DailyBarChartProps) {
  const shares = dailyBarShares(bars.map((bar) => bar.value));
  return (
    <VStack align="stretch" gap={1.5} data-testid={testId}>
      <VisuallyHidden>{summary}</VisuallyHidden>
      <Box
        aria-hidden
        height={height}
        display="grid"
        gridTemplateColumns={`repeat(${bars.length}, 1fr)`}
        gap="3px"
        alignItems="end"
        borderBottomWidth="1px"
        borderColor="border"
      >
        {bars.map((bar, index) => (
          <Box
            // A day's position is its identity: one bar per day.
            key={index}
            height={`${(shares[index] ?? 0) * 100}%`}
            background={(shares[index] ?? 0) > 0 ? `${colorPalette}.solid` : "transparent"}
            borderTopRadius="2px"
            title={bar.title}
            data-testid="daily-bar"
            data-empty={(shares[index] ?? 0) === 0 || undefined}
          />
        ))}
      </Box>
      <HStack justify="space-between">
        {axis.map((label) => (
          <Text key={label} textStyle="micro" color="fg.muted">
            {label}
          </Text>
        ))}
      </HStack>
    </VStack>
  );
}
