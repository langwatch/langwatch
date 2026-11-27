/**
 * Monitor's seven-day trend: a sparkline and the average for scoring
 * evaluators, a label strip and the leading label for category evaluators.
 */

import {
  Box,
  HStack,
  Skeleton,
  Text,
  VisuallyHidden,
  VStack,
} from "@langwatch/design-system/primitives";
import type { LabelShare, OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";

type PerformanceRow = {
  name: string;
  performance?: OnlineEvaluationPerformance;
  hasPerformanceError?: boolean;
};

type Trend = "up" | "down" | "neutral";

const CHART_WIDTH = 112;
const CHART_HEIGHT = 38;

/** Strip colours by rank, so neighbouring segments always differ. */
const LABEL_COLORS = ["blue.solid", "green.solid", "orange.solid", "purple.solid", "teal.solid"];
const GROUPED_LABEL_COLOR = "gray.emphasized";

const TREND_COLOR: Record<Trend, string> = { up: "green.fg", down: "red.fg", neutral: "fg.muted" };

const TREND_STROKE: Record<Trend, string> = {
  up: "var(--chakra-colors-green-fg)",
  down: "var(--chakra-colors-red-fg)",
  neutral: "var(--chakra-colors-fg-subtle)",
};

function trendOf(delta: number | null): Trend {
  if (delta === null || delta === 0) return "neutral";
  return delta > 0 ? "up" : "down";
}

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

  const { current, previous } = performance;
  const delta = current !== null && previous !== null ? current - previous : null;
  const trend = trendOf(delta);
  const trendColor = TREND_COLOR[trend];

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

  if (performance.metric === "label") {
    return (
      <LabelPreview
        labels={performance.labels}
        current={current}
        delta={delta}
        trend={trend}
        name={row.name}
      />
    );
  }

  const { metric, points } = performance;
  return (
    <HStack width="full" gap={4} justify="space-between">
      <Sparkline points={points} trend={trend} name={row.name} />
      <VStack minWidth="82px" align="start" gap={0}>
        <Text fontWeight="semibold">
          {metric === "pass_rate" ? percent(current) : current.toFixed(2)}
        </Text>
        <Text textStyle="xs" color={trendColor} data-trend={trend}>
          {formatTrend({ metric, delta })}
        </Text>
      </VStack>
    </HStack>
  );
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

const formatLabelShare = ({ current, delta }: { current: number; delta: number | null }) => {
  if (delta === null) return `${percent(current)} of results`;
  if (delta === 0) return `${percent(current)}, no change`;
  const arrow = delta > 0 ? "↑" : "↓";
  return `${percent(current)}, ${arrow} ${Math.round(Math.abs(delta) * 100)} pp`;
};

const LabelPreview = ({
  labels,
  current,
  delta,
  trend,
  name,
}: {
  labels: LabelShare[];
  current: number;
  delta: number | null;
  trend: Trend;
  name: string;
}) => {
  const leading = labels[0];
  return (
    <HStack width="full" gap={4} justify="space-between">
      <LabelDistribution labels={labels} name={name} />
      <VStack minWidth="82px" align="start" gap={0}>
        <Text fontWeight="semibold" lineClamp={1} title={leading?.label}>
          {leading?.label}
        </Text>
        <Text textStyle="xs" color={TREND_COLOR[trend]} data-trend={trend}>
          {formatLabelShare({ current, delta })}
        </Text>
      </VStack>
    </HStack>
  );
};

const segmentName = (entry: LabelShare) => (entry.grouped ? "Other labels" : entry.label);

/** One strip, a segment per label sized by share; the hidden list names them for screen readers. */
const LabelDistribution = ({ labels, name }: { labels: LabelShare[]; name: string }) => (
  <HStack
    as="figure"
    margin={0}
    aria-label={`Label distribution for ${name}`}
    width={`${CHART_WIDTH}px`}
    height={`${CHART_HEIGHT}px`}
    flexShrink={0}
    gap="1px"
    align="center"
  >
    {labels.map((entry, index) => (
      <Box
        key={`${entry.grouped ? "grouped" : "label"}:${entry.label}`}
        aria-hidden="true"
        title={`${segmentName(entry)}: ${percent(entry.share)} (${entry.count})`}
        flexGrow={entry.share}
        flexBasis={0}
        minWidth={0}
        height="14px"
        borderRadius="xs"
        background={entry.grouped ? GROUPED_LABEL_COLOR : LABEL_COLORS[index % LABEL_COLORS.length]}
      />
    ))}
    <VisuallyHidden as="ul">
      {labels.map((entry) => (
        <li key={`${entry.grouped ? "grouped" : "label"}:${entry.label}`}>
          {`${segmentName(entry)}, ${percent(entry.share)}`}
        </li>
      ))}
    </VisuallyHidden>
  </HStack>
);

const formatTrend = ({
  metric,
  delta,
}: {
  metric: "score" | "pass_rate";
  delta: number | null;
}) => {
  if (delta === null) return "No comparison";
  if (delta === 0) return "No change";

  const arrow = delta > 0 ? "↑" : "↓";
  const difference = Math.abs(delta);

  return metric === "pass_rate"
    ? `${arrow} ${Math.round(difference * 100)} pp`
    : `${arrow} ${difference.toFixed(2)}`;
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
          : padding + (index / (finitePoints.length - 1)) * (width - padding * 2);
      const y = isFlat
        ? height / 2
        : height - padding - ((point - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const stroke = TREND_STROKE[trend];

  return (
    <Box
      as="figure"
      margin={0}
      aria-label={`Performance trend for ${name}`}
      width={`${width}px`}
      height={`${height}px`}
      flexShrink={0}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
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
