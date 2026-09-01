import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getHexColorForString } from "~/utils/rotatingColors";

import type { DailyBucket, RankRow } from "./sampleSeries";

const AXIS_TICK = { fontSize: 11, fill: "#64748b" } as const;
const GRID_STROKE = "#e2e8f0";

/** Compact above a thousand, exact below it. Money is read, not audited, here. */
function fmtMoney(value: number): string {
  if (value === 0) return "$0";
  if (Math.abs(value) >= 1000) return numeral(value).format("$0.[0]a");
  return numeral(value).format("$0,0.[00]");
}

export function fmtCount(value: number): string {
  return numeral(value).format("0.[0]a");
}

/** ISO day (or full ISO timestamp) to a short `Jul 5` tick. */
export function formatDayTick(day: string | number): string {
  const iso = String(day).slice(0, 10);
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(day);
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The two reasons a panel has nothing to draw, kept apart on purpose.
 *
 * A read that answered with no rows measured the window and found it empty.
 * A read that never answered — still in flight, or never allowed to run —
 * measured nothing at all. "Nothing in this window yet" is a result, so
 * showing it for the second case reports a finding the screen does not have.
 * `null` rows mean unanswered; an empty array means measured-and-empty.
 */
function EmptyPanel({
  height,
  unanswered,
}: {
  height: string;
  unanswered: boolean;
}) {
  return (
    <VStack align="center" justify="center" height={height} color="fg.muted">
      <Text fontSize="sm">
        {unanswered ? "Not available." : "Nothing in this window yet."}
      </Text>
    </VStack>
  );
}

/**
 * Ranked horizontal bars — label, a bar proportional to the leader, and the
 * figure. The bar is scaled against the largest row rather than the total, so
 * a long tail stays legible instead of collapsing into slivers.
 */
export function CostRankList({
  rows,
  format = fmtMoney,
  maxRows = 8,
}: {
  rows: RankRow[] | null;
  format?: (value: number) => string;
  maxRows?: number;
}) {
  const shown = useMemo(
    // Copied before sorting: these rows can be a query cache, and sorting in
    // place would reorder what every other reader of that cache sees.
    () => [...(rows ?? [])].sort((a, b) => b.value - a.value).slice(0, maxRows),
    [rows, maxRows],
  );
  const leader = shown[0]?.value ?? 0;

  if (rows === null) return <EmptyPanel height="220px" unanswered />;
  if (shown.length === 0)
    return <EmptyPanel height="220px" unanswered={false} />;

  return (
    <VStack align="stretch" gap={2}>
      {shown.map((row) => (
        <HStack key={row.key} gap={3} fontSize="sm">
          <Text flex="0 0 34%" truncate title={row.label}>
            {row.label}
          </Text>
          <Box
            flex="1"
            height="14px"
            borderRadius="sm"
            backgroundColor="bg.muted"
            overflow="hidden"
          >
            <Box
              height="100%"
              borderRadius="sm"
              width={leader > 0 ? `${(row.value / leader) * 100}%` : "0%"}
              backgroundColor={getHexColorForString(row.label)}
            />
          </Box>
          <Text
            flex="0 0 18%"
            textAlign="right"
            fontVariantNumeric="tabular-nums"
          >
            {format(row.value)}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Donut with the breakdown listed beside it. The list carries the figures, so
 * the ring itself needs no labels.
 */
export function CostDonut({ rows }: { rows: RankRow[] }) {
  const shown = useMemo(
    () => [...rows].sort((a, b) => b.value - a.value).slice(0, 8),
    [rows],
  );
  const total = shown.reduce((sum, row) => sum + row.value, 0);

  if (total === 0) return <EmptyPanel height="220px" unanswered={false} />;

  return (
    <HStack align="center" gap={4}>
      <Box width="150px" height="180px" flexShrink={0}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="label"
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={1}
              isAnimationActive={false}
              stroke="none"
            >
              {shown.map((row) => (
                <Cell key={row.key} fill={getHexColorForString(row.label)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => fmtMoney(Number(value))}
              contentStyle={{ fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </Box>
      <VStack align="stretch" gap={1.5} flex="1" fontSize="xs">
        {shown.map((row) => (
          <HStack key={row.key} gap={2}>
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              flexShrink={0}
              backgroundColor={getHexColorForString(row.label)}
            />
            <Text truncate title={row.label} flex="1">
              {row.label}
            </Text>
            <Text fontVariantNumeric="tabular-nums">{fmtMoney(row.value)}</Text>
            <Text color="fg.muted" flex="0 0 32px" textAlign="right">
              {Math.round((row.value / total) * 100)}%
            </Text>
          </HStack>
        ))}
      </VStack>
    </HStack>
  );
}

function seriesKeysOf(buckets: DailyBucket[]): Array<{
  key: string;
  label: string;
}> {
  const labelByKey = new Map<string, string>();
  for (const bucket of buckets) {
    for (const point of bucket.points) {
      if (!labelByKey.has(point.key)) labelByKey.set(point.key, point.label);
    }
  }
  return [...labelByKey.entries()].map(([key, label]) => ({ key, label }));
}

function widenBuckets(
  buckets: DailyBucket[],
  keys: Array<{ key: string; label: string }>,
): Array<Record<string, number | string>> {
  return buckets.map((bucket) => {
    const row: Record<string, number | string> = { day: bucket.day };
    for (const k of keys) row[k.key] = 0;
    for (const point of bucket.points) row[point.key] = point.value;
    return row;
  });
}

/**
 * Called as a plain function at the call sites below, not rendered as
 * `<ChartLegend />`. Recharts inspects the *type* of each direct child to
 * decide what it is, and a custom wrapper component is not a `Legend` as far
 * as that inspection is concerned — wrapping this in JSX makes the legend
 * silently disappear. Calling it returns the `Legend` element itself, which is
 * what Recharts needs to see.
 */
function ChartLegend({
  keys,
}: {
  keys: Array<{ key: string; label: string }>;
}) {
  return (
    <Legend
      wrapperStyle={{ fontSize: 11 }}
      iconType="circle"
      formatter={(value: string) =>
        keys.find((k) => k.key === value)?.label ?? value
      }
    />
  );
}

/** Daily stacked bars — the shape the cost-evolution panels want. */
export function CostStackedBars({
  buckets,
  height = "220px",
  format = fmtMoney,
  showLegend = true,
}: {
  buckets: DailyBucket[] | null;
  height?: string;
  format?: (value: number) => string;
  showLegend?: boolean;
}) {
  const keys = useMemo(() => seriesKeysOf(buckets ?? []), [buckets]);
  const rows = useMemo(
    () => widenBuckets(buckets ?? [], keys),
    [buckets, keys],
  );

  if (buckets === null) return <EmptyPanel height={height} unanswered />;
  if (rows.length === 0)
    return <EmptyPanel height={height} unanswered={false} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={formatDayTick}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value, name) => [
              format(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => formatDayTick(label as string)}
            contentStyle={{ fontSize: 12 }}
          />
          {showLegend && ChartLegend({ keys })}
          {keys.map((k) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              stackId="cost"
              fill={getHexColorForString(k.label)}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

/**
 * Stacked area with the tail of the window shaded as a projection. The
 * projected span is drawn from the same series — it is a run-rate carried
 * forward, not a separate measurement — and marked so it cannot be read as
 * something already spent.
 */
export function CostForecastArea({
  buckets,
  projectedFromDay,
  height = "220px",
}: {
  buckets: DailyBucket[];
  projectedFromDay: string | null;
  height?: string;
}) {
  const keys = useMemo(() => seriesKeysOf(buckets), [buckets]);
  const rows = useMemo(() => widenBuckets(buckets, keys), [buckets, keys]);
  const lastDay = rows[rows.length - 1]?.day;

  if (rows.length === 0)
    return <EmptyPanel height={height} unanswered={false} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={formatDayTick}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtMoney} width={58} />
          <Tooltip
            formatter={(value, name) => [
              fmtMoney(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => formatDayTick(label as string)}
            contentStyle={{ fontSize: 12 }}
          />
          {ChartLegend({ keys })}
          {projectedFromDay && lastDay && (
            <ReferenceArea
              x1={projectedFromDay}
              x2={String(lastDay)}
              fill="#94a3b8"
              fillOpacity={0.12}
            />
          )}
          {projectedFromDay && (
            <ReferenceLine
              x={projectedFromDay}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{
                value: "projected",
                position: "insideTopRight",
                fontSize: 10,
                fill: "#94a3b8",
              }}
            />
          )}
          {keys.map((k) => (
            <Area
              key={k.key}
              type="monotone"
              dataKey={k.key}
              stackId="cost"
              stroke={getHexColorForString(k.label)}
              strokeWidth={1.5}
              fill={getHexColorForString(k.label)}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** One spiky line, for counts rather than money. */
export function CostLine({
  points,
  height = "220px",
  format = fmtCount,
}: {
  points: Array<{ day: string; value: number }>;
  height?: string;
  format?: (value: number) => string;
}) {
  if (points.length === 0)
    return <EmptyPanel height={height} unanswered={false} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="cost-line-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3182ce" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#3182ce" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={formatDayTick}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value) => format(Number(value))}
            labelFormatter={(label) => formatDayTick(label as string)}
            contentStyle={{ fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#3182ce"
            strokeWidth={1.5}
            fill="url(#cost-line-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
