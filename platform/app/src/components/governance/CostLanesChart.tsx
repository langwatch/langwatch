import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import type { GovernanceCostDayDto } from "@ee/governance/services/governanceCost.service";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatLaneUsd } from "./costLaneFormat";

/** The two lanes' colors. Fixed, so a lane keeps its color between renders. */
const BILLED_COLOR = "#7c3aed";
const GATEWAY_COLOR = "#0ea5e9";

/** No day in the window reported anything — said, rather than drawn empty. */
function NoReportedDays() {
  return (
    <Box
      data-testid="cost-lanes-chart-empty"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={5}
    >
      <Text fontSize="sm" color="fg.muted">
        No days in this window have reported cost yet.
      </Text>
    </Box>
  );
}

/**
 * The plot itself: one area per lane, both over the same baseline.
 *
 * `connectNulls={false}` is what leaves a gap on a day a lane holds no
 * figure, instead of drawing a line through it down to the axis.
 */
function LaneAreas({ series }: { series: readonly GovernanceCostDayDto[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={[...series]}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={24} />
        <YAxis
          tick={{ fontSize: 11 }}
          width={70}
          tickFormatter={(value: number) => formatLaneUsd(value)}
        />
        <Tooltip
          formatter={(value) =>
            formatLaneUsd(value === null ? null : Number(value))
          }
          contentStyle={{ fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
        <Area
          type="monotone"
          dataKey="billedUsd"
          name="Billed by provider"
          stroke={BILLED_COLOR}
          fill={BILLED_COLOR}
          fillOpacity={0.15}
          strokeWidth={1.5}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="gatewayUsd"
          name="Metered by gateway"
          stroke={GATEWAY_COLOR}
          fill={GATEWAY_COLOR}
          fillOpacity={0.15}
          strokeWidth={1.5}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Billed and gateway cost per day, UNSTACKED.
 *
 * Stacking would draw the two lanes as parts of one total, and they are not:
 * they are two independent measurements of overlapping traffic, so a stack
 * would render a combined height that nobody was ever charged. Each lane is
 * its own area over the same baseline, which is what lets a reader see them
 * disagree.
 *
 * A day where a lane holds no figure carries null, and recharts leaves a gap
 * rather than drawing down to the axis — the chart's version of the same rule
 * the panels follow. A day the read could only price part of carries null for
 * the same reason: a point drawn at the priced part would sit lower than the
 * day cost, and nothing about its position would say so.
 */
export function CostLanesChart({
  series,
}: {
  series: readonly GovernanceCostDayDto[];
}) {
  if (series.length === 0) return <NoReportedDays />;

  // Without this, a deliberate gap is indistinguishable from lost data, and
  // the reader's most likely reading of a hole in a cost chart is that the
  // product dropped something.
  const hasWithheldDay = series.some(
    (day) =>
      day.billedCellsWithoutAmount > 0 || day.gatewayCellsWithoutAmount > 0,
  );

  return (
    <VStack
      data-testid="cost-lanes-chart"
      align="stretch"
      gap={2}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={5}
    >
      <Heading size="sm">Cost per day</Heading>
      <Box height="260px">
        <LaneAreas series={series} />
      </Box>
      {hasWithheldDay ? (
        <Text fontSize="xs" color="fg.subtle" data-testid="cost-lanes-chart-note">
          Days with usage billed in a currency other than US dollars are left
          blank rather than drawn at part of what they cost.
        </Text>
      ) : null}
    </VStack>
  );
}
