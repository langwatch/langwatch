/**
 * The charted block views: generic line and ranking for library blocks, and
 * the throughput, quality and feedback panels of the Flight Deck. Recharts,
 * as the rest of analytics draws, coloured from the Chakra palette.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
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

/** The throughput tooltip's value for a named series: latency, error rate, or a plain count. */
function formatTooltipValue({ value, name }: { value: unknown; name: string }): string {
  if (name === "p95 latency") return formatMs(Number(value));
  if (name === "error rate") return formatRatio(Number(value));
  return formatCount(Number(value));
}

export const CHART_COLORS = {
  primary: "var(--chakra-colors-orange-400)",
  accent: "var(--chakra-colors-teal-500)",
  danger: "var(--chakra-colors-red-500)",
  series: [
    "var(--chakra-colors-teal-500)",
    "var(--chakra-colors-orange-400)",
    "var(--chakra-colors-purple-500)",
    "var(--chakra-colors-blue-500)",
  ],
  grid: "var(--chakra-colors-border-muted)",
} as const;

const AXIS_TICK = { fontSize: 11 };

export interface ChartViewProps {
  readonly rows: BlockRows;
  readonly unit: BlockUnit;
  readonly granularitySeconds: number;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <HStack gap={1.5} fontSize="11px" color="fg.muted">
      <Box boxSize={2} borderRadius="full" background={color} />
      {label}
    </HStack>
  );
}

/** Rows keyed by their bucket label, so two statements over one period can share an axis. */
function byBucket(rows: readonly BlockRow[], granularitySeconds: number): Map<string, BlockRow> {
  return new Map(rows.map((row) => [formatBucket({ value: row.bucket, granularitySeconds }), row]));
}

/** Every numeric column after `bucket` becomes one line. */
export function LineView({ rows, unit, granularitySeconds }: ChartViewProps) {
  const answer = rows.main ?? [];
  const seriesKeys = Object.keys(answer[0] ?? {}).filter((key) => key !== "bucket");
  const data = answer.map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    ...Object.fromEntries(seriesKeys.map((key) => [key, rowNumber(row, key)])),
  }));
  return (
    <Box height="220px">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(value: number) => formatValue({ value, unit })}
          />
          <Tooltip formatter={(value) => formatValue({ value: Number(value), unit })} />
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

/** A horizontal leaderboard: first column is the label, second the value. */
export function RankingList({
  rows,
  unit,
  color = CHART_COLORS.primary,
}: {
  rows: readonly BlockRow[];
  unit: BlockUnit;
  color?: string;
}) {
  const [labelKey = "", valueKey = ""] = Object.keys(rows[0] ?? {});
  const max = Math.max(...rows.map((row) => rowNumber(row, valueKey)), Number.MIN_VALUE);
  return (
    <VStack align="stretch" gap={1.5}>
      {rows.map((row) => {
        const value = rowNumber(row, valueKey);
        return (
          <HStack key={rowText(row, labelKey)} gap={3} fontSize="13px">
            <Text flex="0 0 40%" truncate>
              {rowText(row, labelKey) || "Unknown"}
            </Text>
            <Box flex={1} height="14px" borderRadius="sm" background="bg.muted">
              <Box
                height="full"
                borderRadius="sm"
                background={color}
                width={`${(value / max) * 100}%`}
              />
            </Box>
            <Text flex="0 0 64px" textAlign="right" fontVariantNumeric="tabular-nums">
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
export function ThroughputView({ rows, granularitySeconds }: ChartViewProps) {
  const data = (rows.main ?? []).map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    throughput: rowNumber(row, "throughput"),
    p95: rowNumber(row, "p95_ms"),
    errorRate: rowNumber(row, "error_rate"),
  }));
  const maxRate = Math.max(0.01, ...data.map((point) => point.errorRate));
  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={3}>
        <LegendItem color={CHART_COLORS.primary} label="throughput" />
        <LegendItem color={CHART_COLORS.accent} label="p95 latency" />
        <LegendItem color={CHART_COLORS.danger} label="error rate" />
      </HStack>
      <Box height="256px">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis
              yAxisId="req"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={formatCount}
            />
            <YAxis
              yAxisId="ms"
              orientation="right"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={formatMs}
            />
            <YAxis yAxisId="rate" hide domain={[0, maxRate * 4]} />
            <Tooltip formatter={(value, name) => formatTooltipValue({ value, name })} />
            <Area
              yAxisId="rate"
              type="monotone"
              dataKey="errorRate"
              name="error rate"
              stroke={CHART_COLORS.danger}
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
export function QualityView({ rows, granularitySeconds }: ChartViewProps) {
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
    <VStack align="stretch" gap={1}>
      <HStack gap={3}>
        <LegendItem color={CHART_COLORS.accent} label="evaluator pass rate" />
        <LegendItem color={CHART_COLORS.danger} label="error rate" />
      </HStack>
      <Box height="160px">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, 1]}
              tickFormatter={(value: number) => formatRatio(value, 0)}
            />
            <Tooltip formatter={(value) => formatRatio(Number(value))} />
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
export function FeedbackView({ rows, granularitySeconds }: ChartViewProps) {
  const summary = rows.summary?.[0];
  const up = rowNumber(summary, "thumbs_up");
  const down = rowNumber(summary, "thumbs_down");
  const data = (rows.rate ?? []).map((row) => ({
    x: formatBucket({ value: row.bucket, granularitySeconds }),
    positive: rowNumber(row, "positive_rate"),
  }));
  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={4}>
        <Text fontSize="22px" fontWeight="semibold">
          {formatRatio(up + down > 0 ? up / (up + down) : 0, 0)}
        </Text>
        <HStack gap={1} fontSize="12px" color="green.fg">
          <ThumbsUp size={13} /> {formatCount(up)}
        </HStack>
        <HStack gap={1} fontSize="12px" color="red.fg">
          <ThumbsDown size={13} /> {formatCount(down)}
        </HStack>
      </HStack>
      <Box height="128px">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis dataKey="x" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, 1]}
              tickFormatter={(value: number) => formatRatio(value, 0)}
            />
            <Tooltip formatter={(value) => formatRatio(Number(value))} />
            <Line
              type="monotone"
              dataKey="positive"
              name="positive feedback"
              stroke={CHART_COLORS.series[2]}
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
