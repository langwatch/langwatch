/**
 * The charted block views: generic line and ranking for library blocks, and
 * the throughput, quality and feedback panels of the Flight Deck. Recharts,
 * as the rest of analytics draws, coloured from the Chakra palette.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { ReactNode } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BlockUnit } from "../model/block-definition.ts";
import {
  type BlockRow,
  type BlockRows,
  formatBucket,
  formatCount,
  formatMs,
  formatRatio,
  formatValue,
  rowNumber,
  rowText,
} from "../model/block-format.ts";

export const CHART_COLORS = {
  primary: "var(--chakra-colors-orange-400)",
  accent: "var(--chakra-colors-teal-solid)",
  danger: "var(--chakra-colors-red-solid)",
  series: [
    "var(--chakra-colors-teal-500)",
    "var(--chakra-colors-orange-400)",
    "var(--chakra-colors-purple-500)",
    "var(--chakra-colors-blue-500)",
  ],
  /** The prototype's categorical ramp, one hue per ranked row. */
  ramp: [
    "var(--chakra-colors-blue-400)",
    "var(--chakra-colors-orange-400)",
    "var(--chakra-colors-purple-400)",
    "var(--chakra-colors-green-400)",
    "var(--chakra-colors-pink-400)",
    "var(--chakra-colors-teal-400)",
    "var(--chakra-colors-cyan-400)",
    "var(--chakra-colors-yellow-400)",
  ],
  grid: "var(--chakra-colors-border)",
} as const;

/** The prototype's fixed ramp slots: a headline entity keeps its hue on every chart. */
const FIXED_RAMP_SLOTS: Readonly<Record<string, number>> = {
  "gpt-5": 0,
  "claude-sonnet-4.5": 1,
  "llama-4-70b": 2,
  "gemini-2.5-pro": 3,
  "claude-opus-4.5": 4,
  "gpt-5-mini": 5,
};

/** A ranked row's hue: its fixed slot when it has one, otherwise its rank's. */
export function rampColor({ label, index }: { label: string; index: number }): string {
  const slot = FIXED_RAMP_SLOTS[label] ?? index;
  return CHART_COLORS.ramp[slot % CHART_COLORS.ramp.length] ?? CHART_COLORS.primary;
}

/**
 * The plot's size: fixed on the Flight Deck, and growing to fill the card on
 * a member's board, where the grid sets the card's height.
 */
function plotSize({ fill, height }: { fill: boolean; height: string }) {
  return fill ? { flex: 1, minHeight: height } : { height };
}

const AXIS_TICK = {
  fontSize: 10.5,
  fontFamily: "var(--chakra-fonts-mono)",
  fill: "var(--chakra-colors-gray-400)",
};

const TOOLTIP_CURSOR = { fill: CHART_COLORS.accent, fillOpacity: 0.06 };

/** One charted bucket as the tooltip reads it: the axis label and the drawn values. */
type ChartPoint = { x: string } & Readonly<Record<string, number | string>>;

/**
 * The prototype's tooltip. Kept separate from the shared `ChartTooltip`,
 * whose blurred panel and colour swatches would change this
 * prototype-matched look. Recharts fills `active`, `payload` and `label`.
 */
function BlockTooltip({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: readonly { payload?: ChartPoint }[];
  label?: string | number;
  rows: (point: ChartPoint) => readonly { label: string; value: string }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg.panel"
      paddingX={2.5}
      paddingY={2}
      boxShadow="lg"
    >
      <Text marginBottom={1} fontFamily="mono" fontSize="10.5px" color="gray.400">
        {label}
      </Text>
      {rows(point).map((row) => (
        <HStack key={row.label} gap={4} fontSize="12px">
          <Text as="span" color="fg.subtle">
            {row.label}
          </Text>
          <Text as="span" marginLeft="auto" fontWeight="medium" fontVariantNumeric="tabular-nums">
            {row.value}
          </Text>
        </HStack>
      ))}
    </Box>
  );
}

const pointNumber = (point: ChartPoint, key: string) => Number(point[key] ?? 0);

export interface ChartViewProps {
  readonly rows: BlockRows;
  readonly unit: BlockUnit;
  readonly granularitySeconds: number;
  /** Grow the plot to the card's height rather than keep its fixed one. */
  readonly fill?: boolean;
}

function LegendItem({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  const swatch = dashed ? (
    <Box width={3} height={0} borderTopWidth="2px" borderStyle="dashed" borderColor={color} />
  ) : (
    <Box boxSize={2} borderRadius="full" background={color} />
  );
  return (
    <HStack gap={1.5} fontSize="10.5px" color="fg.subtle">
      {swatch}
      {label}
    </HStack>
  );
}

function Legend({ children }: { children: ReactNode }) {
  return (
    <HStack columnGap={3} rowGap={0.5} flexWrap="wrap" marginBottom={1}>
      {children}
    </HStack>
  );
}

/** Rows keyed by their bucket label, so two statements over one period can share an axis. */
function byBucket(rows: readonly BlockRow[], granularitySeconds: number): Map<string, BlockRow> {
  return new Map(rows.map((row) => [formatBucket({ value: row.bucket, granularitySeconds }), row]));
}

/** Every numeric column after `bucket` becomes one line. */
export function LineView({ rows, unit, granularitySeconds, fill = false }: ChartViewProps) {
  const answer = rows.main ?? [];
  const seriesKeys = Object.keys(answer[0] ?? {}).filter((key) => key !== "bucket");
  const data = answer.map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    ...Object.fromEntries(seriesKeys.map((key) => [key, rowNumber(row, key)])),
  }));
  return (
    <Box {...plotSize({ fill, height: "220px" })}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="x"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            dy={4}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width="auto"
            tickFormatter={(value: number) => formatValue({ value, unit })}
          />
          <Tooltip
            cursor={TOOLTIP_CURSOR}
            content={
              <BlockTooltip
                rows={(point) =>
                  seriesKeys.map((key) => ({
                    label: key.replaceAll("_", " "),
                    value: formatValue({ value: pointNumber(point, key), unit }),
                  }))
                }
              />
            }
          />
          {seriesKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key.replaceAll("_", " ")}
              stroke={CHART_COLORS.series[index % CHART_COLORS.series.length]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** A horizontal leaderboard, one ramp hue per row: first column the label, second the value. */
export function RankingList({ rows, unit }: { rows: readonly BlockRow[]; unit: BlockUnit }) {
  const [labelKey = "", valueKey = ""] = Object.keys(rows[0] ?? {});
  const max = Math.max(...rows.map((row) => rowNumber(row, valueKey)), Number.MIN_VALUE);
  return (
    <VStack align="stretch" gap={1.5}>
      {rows.map((row, index) => {
        const value = rowNumber(row, valueKey);
        return (
          <HStack key={rowText(row, labelKey)} gap={2} fontSize="11.5px">
            <Text width="128px" flexShrink={0} color="fg.subtle" truncate>
              {rowText(row, labelKey) || "Unknown"}
            </Text>
            <Box
              position="relative"
              flex={1}
              minWidth={0}
              height={4}
              overflow="hidden"
              borderRadius="4px"
              background="bg.muted"
            >
              <Box
                position="absolute"
                insetY={0}
                left={0}
                borderRadius="4px"
                opacity={0.8}
                background={rampColor({ label: rowText(row, labelKey), index })}
                width={`${(value / max) * 100}%`}
              />
            </Box>
            <Text
              width="56px"
              flexShrink={0}
              textAlign="right"
              fontWeight="medium"
              fontVariantNumeric="tabular-nums"
            >
              {formatValue({ value, unit })}
            </Text>
          </HStack>
        );
      })}
    </VStack>
  );
}

export function RankingView({ rows, unit }: ChartViewProps) {
  return <RankingList rows={rows.main ?? []} unit={unit} />;
}

/** Bars of throughput, a p95 latency line and a low error-rate ribbon on one time axis. */
export function ThroughputView({ rows, granularitySeconds, fill = false }: ChartViewProps) {
  const data = (rows.main ?? []).map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    throughput: rowNumber(row, "throughput"),
    p95: rowNumber(row, "p95_ms"),
    errorRate: rowNumber(row, "error_rate"),
  }));
  const maxRate = Math.max(0.01, ...data.map((point) => point.errorRate));
  return (
    <VStack align="stretch" gap={0} flex={1}>
      <Legend>
        <LegendItem color={CHART_COLORS.primary} label="throughput" />
        <LegendItem color={CHART_COLORS.accent} label="p95 latency" />
        <LegendItem color={CHART_COLORS.danger} label="error rate" />
      </Legend>
      <Box {...plotSize({ fill, height: "256px" })}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="x"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              dy={4}
            />
            <YAxis
              yAxisId="req"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width="auto"
              tickFormatter={formatCount}
            />
            <YAxis
              yAxisId="ms"
              orientation="right"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width="auto"
              tickFormatter={formatMs}
            />
            {/* Zero width: hidden, it still takes its 60px and pushes the labels out. */}
            <YAxis yAxisId="rate" hide width={0} domain={[0, maxRate * 4]} />
            <Tooltip
              cursor={TOOLTIP_CURSOR}
              content={
                <BlockTooltip
                  rows={(point) => [
                    { label: "Throughput", value: formatCount(pointNumber(point, "throughput")) },
                    { label: "p95 latency", value: formatMs(pointNumber(point, "p95")) },
                    { label: "Error rate", value: formatRatio(pointNumber(point, "errorRate")) },
                  ]}
                />
              }
            />
            <Area
              yAxisId="rate"
              type="monotone"
              dataKey="errorRate"
              name="error rate"
              stroke={CHART_COLORS.danger}
              strokeWidth={1.2}
              fill={CHART_COLORS.danger}
              fillOpacity={0.1}
              dot={false}
              isAnimationActive={false}
            />
            <Bar
              yAxisId="req"
              dataKey="throughput"
              name="throughput"
              fill={CHART_COLORS.primary}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
            <Line
              yAxisId="ms"
              type="monotone"
              dataKey="p95"
              name="p95 latency"
              stroke={CHART_COLORS.accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}

/** Evaluator pass rate against the trace error rate, both as shares of the same buckets. */
export function QualityView({ rows, granularitySeconds, fill = false }: ChartViewProps) {
  const errors = byBucket(rows.errorRate ?? [], granularitySeconds);
  const data = (rows.passRate ?? []).map((row) => {
    const x = formatBucket({ value: row.bucket, granularitySeconds });
    return {
      x,
      passRate: rowNumber(row, "pass_rate"),
      errorRate: rowNumber(errors.get(x), "error_rate"),
    };
  });
  return (
    <VStack align="stretch" gap={0} flex={1}>
      <Legend>
        <LegendItem color={CHART_COLORS.accent} label="evaluator pass rate" />
        <LegendItem color={CHART_COLORS.danger} label="error rate" dashed />
      </Legend>
      <Box {...plotSize({ fill, height: "160px" })}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="x"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              dy={4}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width="auto"
              domain={[0, 1]}
              tickFormatter={(value: number) => formatRatio(value, 0)}
            />
            <Tooltip
              cursor={TOOLTIP_CURSOR}
              content={
                <BlockTooltip
                  rows={(point) => [
                    { label: "Pass rate", value: formatRatio(pointNumber(point, "passRate"), 0) },
                    { label: "Error rate", value: formatRatio(pointNumber(point, "errorRate")) },
                  ]}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="passRate"
              name="pass rate"
              stroke={CHART_COLORS.accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="errorRate"
              name="error rate"
              stroke={CHART_COLORS.danger}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}

/** Thumbs totals, then the positive share over time. */
export function FeedbackView({ rows, granularitySeconds, fill = false }: ChartViewProps) {
  const summary = rows.summary?.[0];
  const up = rowNumber(summary, "thumbs_up");
  const down = rowNumber(summary, "thumbs_down");
  const data = (rows.rate ?? []).map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    positive: rowNumber(row, "positive_rate"),
  }));
  return (
    <VStack align="stretch" gap={0} flex={1}>
      <HStack gap={4} marginBottom={3}>
        <Text fontSize="22px" fontWeight="semibold" fontVariantNumeric="tabular-nums">
          {formatRatio(up + down > 0 ? up / (up + down) : 0, 0)}
        </Text>
        <HStack gap={1} fontSize="12px" color="green.solid">
          <ThumbsUp size={13} /> {formatCount(up)}
        </HStack>
        <HStack gap={1} fontSize="12px" color="red.solid">
          <ThumbsDown size={13} /> {formatCount(down)}
        </HStack>
      </HStack>
      <Legend>
        <LegendItem color={CHART_COLORS.ramp[4]} label="positive feedback rate" dashed />
      </Legend>
      <Box {...plotSize({ fill, height: "128px" })}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="x"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={28}
              dy={4}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width="auto"
              domain={[0, 1]}
              tickFormatter={(value: number) => formatRatio(value, 0)}
            />
            <Tooltip
              cursor={TOOLTIP_CURSOR}
              content={
                <BlockTooltip
                  rows={(point) => [
                    {
                      label: "Positive feedback",
                      value: formatRatio(pointNumber(point, "positive"), 0),
                    },
                  ]}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="positive"
              name="positive feedback"
              stroke={CHART_COLORS.ramp[4]}
              strokeWidth={1.8}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}

/** A minimal inline trend line, so a table row stays cheap. */
export function Sparkline({ points }: { points: readonly number[] }) {
  const width = 48;
  const height = 14;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const span = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={CHART_COLORS.accent} strokeWidth={1.5} />
    </svg>
  );
}
