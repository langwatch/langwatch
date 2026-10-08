import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";

import { getHexColorForString } from "~/utils/rotatingColors";

export type LabelShare = {
  label: string;
  count: number;
  share: number;
};

export type OnlineEvaluationPerformance =
  | {
      metric: "score" | "pass_rate";
      points: number[];
      current: number | null;
      previous: number | null;
    }
  | {
      metric: "label";
      labels: LabelShare[];
      current: number | null;
      previous: number | null;
    };

type PerformanceRow = {
  name: string;
  performance?: OnlineEvaluationPerformance;
  hasPerformanceError?: boolean;
};

const CHART_WIDTH = 112;
const CHART_HEIGHT = 38;

export const PerformancePreview = ({ row }: { row: PerformanceRow }) => {
  const performance = row.performance;

  if (row.hasPerformanceError) {
    return (
      <Text textStyle="sm" color="fg.muted">
        Performance unavailable
      </Text>
    );
  }

  if (!performance) {
    return (
      <HStack width="full" gap={4}>
        <Skeleton width={`${CHART_WIDTH}px`} height={`${CHART_HEIGHT}px`} />
        <VStack align="start" gap={1}>
          <Skeleton width="48px" height="18px" />
          <Skeleton width="64px" height="14px" />
        </VStack>
      </HStack>
    );
  }

  const { current, previous, metric } = performance;
  const delta =
    current !== null && previous !== null ? current - previous : null;
  const trend =
    delta === null || delta === 0 ? "neutral" : delta > 0 ? "up" : "down";
  const trendColor =
    trend === "up" ? "green.fg" : trend === "down" ? "red.fg" : "fg.muted";

  if (current === null) {
    return (
      <HStack width="full" gap={4}>
        <Sparkline points={[]} trend="neutral" name={row.name} />
        <Text textStyle="sm" color="fg.muted" data-trend="neutral">
          No data yet
        </Text>
      </HStack>
    );
  }

  // A classifier's period is a distribution, not an average: every result
  // carries a label and neither a score nor a pass flag, so there is nothing
  // to average and a single number would say less than the split does.
  if (metric === "label") {
    const leading = performance.labels[0];
    return (
      <HStack width="full" gap={4} justify="space-between">
        <LabelDistribution labels={performance.labels} name={row.name} />
        <VStack minWidth="82px" align="start" gap={0}>
          <Text fontWeight="semibold" lineClamp={1} title={leading?.label}>
            {leading?.label}
          </Text>
          <Text textStyle="xs" color={trendColor} data-trend={trend}>
            {formatLabelShare(current, delta)}
          </Text>
        </VStack>
      </HStack>
    );
  }

  return (
    <HStack width="full" gap={4} justify="space-between">
      <Sparkline points={performance.points} trend={trend} name={row.name} />
      <VStack minWidth="82px" align="start" gap={0}>
        <Text fontWeight="semibold">
          {metric === "pass_rate"
            ? `${Math.round(current * 100)}%`
            : current.toFixed(2)}
        </Text>
        <Text textStyle="xs" color={trendColor} data-trend={trend}>
          {formatTrend(metric, delta)}
        </Text>
      </VStack>
    </HStack>
  );
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

const formatLabelShare = (current: number, delta: number | null) => {
  if (delta === null) return `${percent(current)} of results`;
  if (delta === 0) return `${percent(current)}, no change`;
  const arrow = delta > 0 ? "↑" : "↓";
  return `${percent(current)}, ${arrow} ${Math.round(Math.abs(delta) * 100)} pp`;
};

const formatTrend = (metric: "score" | "pass_rate", delta: number | null) => {
  if (delta === null) return "No comparison";
  if (delta === 0) return "No change";

  const arrow = delta > 0 ? "↑" : "↓";
  const difference = Math.abs(delta);

  return metric === "pass_rate"
    ? `${arrow} ${Math.round(difference * 100)} pp`
    : `${arrow} ${difference.toFixed(2)}`;
};

/**
 * The period's labels as one strip, each segment sized by its share.
 *
 * Every segment carries its own accessible name and hover title, so the split
 * is readable without a legend the column has no room for.
 */
const LabelDistribution = ({
  labels,
  name,
}: {
  labels: LabelShare[];
  name: string;
}) => {
  const height = 14;
  const gap = 1;
  const radius = 2;

  let offset = 0;
  const segments = labels.map((entry) => {
    const width = Math.max(entry.share * CHART_WIDTH - gap, 1);
    const segment = { ...entry, x: offset, width };
    offset += entry.share * CHART_WIDTH;
    return segment;
  });

  return (
    <Box
      width={`${CHART_WIDTH}px`}
      height={`${CHART_HEIGHT}px`}
      flexShrink={0}
      display="flex"
      alignItems="center"
    >
      <svg
        role="group"
        aria-label={`Label distribution for ${name}`}
        viewBox={`0 0 ${CHART_WIDTH} ${height}`}
        width="100%"
        height={height}
      >
        {segments.map((segment) => (
          <rect
            key={segment.label}
            role="img"
            aria-label={`${segment.label}, ${percent(segment.share)}`}
            x={segment.x}
            y={0}
            width={segment.width}
            height={height}
            rx={radius}
            fill={getHexColorForString(segment.label)}
          >
            <title>{`${segment.label}: ${percent(segment.share)} (${segment.count})`}</title>
          </rect>
        ))}
      </svg>
    </Box>
  );
};

const Sparkline = ({
  points,
  trend,
  name,
}: {
  points: number[];
  trend: "up" | "down" | "neutral";
  name: string;
}) => {
  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const padding = 3;
  const finitePoints = points.filter(Number.isFinite);
  const min = finitePoints.length > 0 ? Math.min(...finitePoints) : 0;
  const max = finitePoints.length > 0 ? Math.max(...finitePoints) : 1;
  const range = max - min || 1;
  const isFlat = finitePoints.length > 0 && max === min;
  const polyline = finitePoints
    .map((point, index) => {
      const x =
        finitePoints.length === 1
          ? width / 2
          : padding +
            (index / (finitePoints.length - 1)) * (width - padding * 2);
      const y = isFlat
        ? height / 2
        : height - padding - ((point - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const stroke =
    trend === "up"
      ? "var(--chakra-colors-green-500)"
      : trend === "down"
        ? "var(--chakra-colors-red-500)"
        : "var(--chakra-colors-gray-400)";

  return (
    <Box width={`${width}px`} height={`${height}px`} flexShrink={0}>
      <svg
        role="img"
        aria-label={`Performance trend for ${name}`}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
      >
        {finitePoints.length > 1 ? (
          <polyline
            points={polyline}
            fill="none"
            stroke={stroke}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <line
            x1={padding}
            x2={width - padding}
            y1={height / 2}
            y2={height / 2}
            stroke={stroke}
            strokeWidth="2"
            strokeDasharray="3 4"
          />
        )}
      </svg>
    </Box>
  );
};
