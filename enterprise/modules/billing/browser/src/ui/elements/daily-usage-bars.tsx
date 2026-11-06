/**
 * One bar per day of the month, each as tall as its share of the busiest day, with the first,
 * middle and last day under the axis. Days with nothing draw no bar; a hover names the count.
 */
import { Box, HStack, Text, VStack, VisuallyHidden } from "@langwatch/design-system/primitives";

export function DailyUsageBars({
  heights,
  labels,
  axis,
  summary,
}: {
  /** Each day's height as a share of the busiest, 0 to 1. */
  heights: readonly number[];
  /** Each day's count, shown on hover: "3 Nov: 4,800 events". */
  labels: readonly string[];
  axis: readonly string[];
  /** What a screen reader hears in place of the bars. */
  summary: string;
}) {
  return (
    <VStack align="stretch" gap={1.5} data-testid="usage-daily-chart">
      <VisuallyHidden>{summary}</VisuallyHidden>
      <Box
        aria-hidden
        height="96px"
        display="grid"
        gridTemplateColumns={`repeat(${heights.length}, 1fr)`}
        gap="3px"
        alignItems="end"
        borderBottomWidth="1px"
        borderColor="border"
      >
        {heights.map((height, index) => (
          <Box
            // A day's position is its identity: the month has one bar per day.
            key={index}
            height={`${height * 100}%`}
            background={height > 0 ? "orange.solid" : "transparent"}
            borderTopRadius="2px"
            title={labels[index]}
            data-testid="usage-daily-bar"
            data-empty={height === 0 || undefined}
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
