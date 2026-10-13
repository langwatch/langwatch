/**
 * A smooth area chart of values over time, drawn with Recharts as the product's charts are: a
 * screen supplies only the points and their unit. Spec: specs/time-series-chart.feature.
 */
import { Box, HStack, Text, VisuallyHidden } from "@chakra-ui/react";
import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { TYPE_SCALE_PX } from "../../system/text-styles.ts";
import { ChartEmptyState } from "../states/chart-empty-state.tsx";

/** One reading. `label` is the whole name of the moment: "Mon 5 Oct". */
export interface TimeSeriesPoint {
  label: string;
  value: number;
}

export interface TimeSeriesSeries {
  /** Names the series in the legend, the tooltip and the summary. */
  name: string;
  points: readonly TimeSeriesPoint[];
}

type FormatValue = (args: { value: number }) => string;

export interface TimeSeriesChartProps {
  /** Names the chart: "Requests per day". */
  label: string;
  /** Series share their moments; the longest one names the x axis. */
  series: readonly TimeSeriesSeries[];
  /** A value as the reader should read it, unit included: "1,180 requests", "$4.96", "1.84 s". */
  formatValue: FormatValue;
  /** The same on the y axis, when a shorter form fits; default `formatValue`. */
  formatTick?: FormatValue;
  /** The sentence screen readers get; default one derived from the points. */
  summary?: string;
  /** Plot height in px. Default 220. */
  height?: number;
  /** One sentence under "No data for this period" when no series has a point. */
  emptyDescription?: string;
  "data-testid"?: string;
}

const MUTED = "var(--chakra-colors-fg-muted)";
const ORANGE = "var(--chakra-colors-orange-solid)";
const FALLBACK_WIDTH = 640;
const TICK = { fontSize: TYPE_SCALE_PX.micro, fill: MUTED } as const;

/** One series alone is the product orange; several take the chart palette in its order. */
function colorOf({ at, count }: { at: number; count: number }): string {
  if (count === 1) return ORANGE;
  return `var(--chakra-colors-chart-${(at % 8) + 1})`;
}

function describeSeries({
  series,
  formatValue,
  named,
}: {
  series: TimeSeriesSeries;
  formatValue: FormatValue;
  named: boolean;
}): string {
  const { points } = series;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  const high = points.reduce((best, point) => (point.value > best.value ? point : best), first);
  const low = points.reduce((best, point) => (point.value < best.value ? point : best), first);
  const subject = named ? `${series.name}: ` : "";
  const span =
    points.length === 1
      ? `1 reading, ${first.label}`
      : `${points.length} readings from ${first.label} to ${last.label}`;
  return `${subject}${span}. Highest ${formatValue({ value: high.value })} on ${high.label}, lowest ${formatValue({ value: low.value })} on ${low.label}, latest ${formatValue({ value: last.value })}.`;
}

/** The sentence a screen reader gets, derived from the points so it cannot disagree with them. */
export function summariseSeries({
  label,
  series,
  formatValue,
}: Pick<TimeSeriesChartProps, "label" | "series" | "formatValue">): string {
  const drawn = series.filter((one) => one.points.length > 0);
  const named = drawn.length > 1;
  const parts = drawn.map((one) => describeSeries({ series: one, formatValue, named }));
  return `${label}. ${parts.join(" ")}`;
}

type Row = Record<string, string | number | undefined>;

/** One row per moment of the longest series, each series' value under its own key. */
function rowsOf({ series }: { series: readonly TimeSeriesSeries[] }): Row[] {
  const longest = series.reduce<readonly TimeSeriesPoint[]>(
    (best, one) => (one.points.length > best.length ? one.points : best),
    [],
  );
  return longest.map((moment, at) => ({
    label: moment.label,
    ...Object.fromEntries(series.map((one, index) => [`s${index}`, one.points[at]?.value])),
  }));
}

/** The product's chart tooltip panel: the moment, then each series with its colour and unit. */
function Reading({
  active,
  payload,
  label,
  formatValue,
  names,
}: Partial<TooltipContentProps<number, string>> & {
  formatValue: FormatValue;
  names: readonly string[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <Box
      data-chart-tooltip=""
      bg="bg.panel/85"
      backdropFilter="blur(8px)"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      paddingX={3}
      paddingY={2}
      boxShadow="lg"
    >
      <Text textStyle="xs" color="fg.muted" fontWeight="medium" marginBottom={1}>
        {label}
      </Text>
      {payload.map((entry) => {
        const at = Number(String(entry.dataKey).slice(1));
        if (typeof entry.value !== "number") return null;
        return (
          <HStack key={String(entry.dataKey)} gap={1.5} align="center">
            <Box
              width="8px"
              height="8px"
              borderRadius="2px"
              flexShrink={0}
              style={{ backgroundColor: entry.color }}
            />
            <Text textStyle="xs" fontVariantNumeric="tabular-nums">
              <Text as="span" color="fg.muted">
                {names[at]}
              </Text>
              {": "}
              {formatValue({ value: entry.value })}
            </Text>
          </HStack>
        );
      })}
    </Box>
  );
}

/** Values over time as smooth lines, the first series also as a soft area, with a hover reading. */
export function TimeSeriesChart({
  label,
  series,
  formatValue,
  formatTick = formatValue,
  summary,
  height = 220,
  emptyDescription,
  "data-testid": testId,
}: TimeSeriesChartProps) {
  const key = useId().replaceAll(":", "");
  const rows = rowsOf({ series });
  if (rows.length === 0) {
    return <ChartEmptyState height={height} description={emptyDescription} testId={testId} />;
  }

  const summaryId = `${key}-summary`;
  const fillId = `${key}-fill`;
  const names = series.map((one) => one.name);

  return (
    <Box
      as="figure"
      margin={0}
      minWidth={0}
      aria-label={label}
      aria-describedby={summaryId}
      data-testid={testId}
    >
      <Box width="full" minWidth={0} height={`${height}px`} aria-hidden="true">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: FALLBACK_WIDTH, height }}
        >
          <AreaChart
            data={rows}
            accessibilityLayer={false}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={colorOf({ at: 0, count: series.length })}
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor={colorOf({ at: 0, count: series.length })}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--chakra-colors-border-subtle)"
              vertical={false}
            />
            <XAxis dataKey="label" tick={TICK} minTickGap={24} />
            <YAxis
              tick={TICK}
              width={56}
              tickFormatter={(value: number) => formatTick({ value })}
            />
            <Tooltip
              content={<Reading formatValue={formatValue} names={names} />}
              cursor={{ stroke: "var(--chakra-colors-border)", strokeDasharray: "3 3" }}
            />
            {series.length > 1 && (
              <Legend
                iconType="square"
                iconSize={8}
                itemSorter={null}
                formatter={(_, entry) => (
                  <span style={{ color: MUTED }}>
                    {names[Number(String(entry.dataKey).slice(1))]}
                  </span>
                )}
                wrapperStyle={{ fontSize: TYPE_SCALE_PX.micro }}
              />
            )}
            {series.map((one, at) => (
              <Area
                key={one.name}
                type="monotone"
                dataKey={`s${at}`}
                name={one.name}
                stroke={colorOf({ at, count: series.length })}
                strokeWidth={2}
                fill={at === 0 ? `url(#${fillId})` : "none"}
                dot={rows.length === 1 ? { r: 3 } : false}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      <VisuallyHidden id={summaryId}>
        {summary ?? summariseSeries({ label, series, formatValue })}
      </VisuallyHidden>
    </Box>
  );
}
