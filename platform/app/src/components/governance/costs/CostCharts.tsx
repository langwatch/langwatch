import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { type ReactNode, useMemo } from "react";
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
import type { TimeInterval } from "~/components/governance/filters";
import { getHexColorForString } from "~/utils/rotatingColors";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  CHART_TOOLTIP_CONTENT,
  CHART_TOOLTIP_CURSOR,
  CHART_TOOLTIP_LABEL,
} from "../chartTheme";

import { formatBucketTick } from "./costsWindow";
import type { DailyBucket, RankRow } from "./sampleSeries";

const AXIS_TICK = CHART_AXIS_TICK;
const GRID_STROKE = CHART_GRID_STROKE;

/**
 * Plot margins shared by every chart on this screen.
 *
 * The right side carries half a tick label rather than the 8px the charts used
 * to have. A period tick is centred on its point, and the last point sits on
 * the plot's right edge, so the overhang was being clipped — "Q3 2026" came
 * out as "Q3 202" with the last digit sliced off. One constant so the four
 * charts cannot drift apart on it.
 */
const CHART_MARGIN = { top: 8, right: 30, bottom: 0, left: 0 } as const;

/** Compact above a thousand, exact below it. Money is read, not audited, here. */
export function fmtMoney(value: number): string {
  if (value === 0) return "$0";
  if (Math.abs(value) >= 1000) return numeral(value).format("$0.[0]a");
  return numeral(value).format("$0,0.[00]");
}

export function fmtCount(value: number): string {
  return numeral(value).format("0.[0]a");
}

/**
 * The tick a bucket start reads as.
 *
 * Every time chart on this page takes the interval in view and formats its
 * axis through `formatBucketTick`, so a screen set to Quarter never draws a
 * chart ticked by day beside one ticked by quarter — two axes that look alike
 * and are not the same span is the one chart mistake a reader cannot catch.
 * A chart with no interval (nothing on this page any more; kept for the
 * daily-series case) falls back to a short `Jul 5`.
 */
export function formatDayTick(
  day: string | number,
  interval?: TimeInterval,
): string {
  if (interval) return formatBucketTick(day, interval);
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
  empty,
}: {
  height: string;
  unanswered: boolean;
  /**
   * What this particular panel says when it has nothing to draw. Every panel
   * on the Costs page passes one — a bare "Not available." names neither the
   * panel nor what would fill it, and a reader's next move on reading it is to
   * report a bug against a screen behaving exactly as designed. The fallback
   * below is for a caller that has not been given its own words yet.
   */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  if (empty) return <>{empty(unanswered)}</>;
  return (
    <VStack align="center" justify="center" height={height} color="fg.muted">
      <Text fontSize="sm">
        {unanswered ? "Not available." : "Nothing in this window yet."}
      </Text>
    </VStack>
  );
}

/** A ranked row with the bar it draws. */
export interface RankBar extends RankRow {
  /** Bar length as a percentage of the panel width. Never negative. */
  widthPct: number;
  isCredit: boolean;
}

/**
 * How long each ranked bar is drawn.
 *
 * Cost here is signed — a credited or refunded period arrives as a negative
 * figure — so the bars are scaled against the largest magnitude rather than
 * against the top row. Scaling against the top row divides by a negative
 * whenever a credit leads, which draws bars pointing the wrong way, and the
 * obvious guard against that collapses a panel of nothing but credits to
 * nothing at all.
 *
 * Extracted from the panel because the width lands in a generated class name
 * that jsdom cannot resolve, which leaves the arithmetic untestable through
 * the rendered output.
 */
export function rankBarGeometry(rows: RankRow[]): RankBar[] {
  const scale = rows.reduce(
    (max, row) => Math.max(max, Math.abs(row.value)),
    0,
  );
  return rows.map((row) => ({
    ...row,
    widthPct: scale > 0 ? (Math.abs(row.value) / scale) * 100 : 0,
    isCredit: row.value < 0,
  }));
}

/**
 * Ranked horizontal bars — label, bar, figure. Rows are ordered by what was
 * spent, and each bar is scaled against the largest figure rather than the
 * total, so a long tail stays legible instead of collapsing into slivers.
 * `rankBarGeometry` explains why "largest" means largest magnitude.
 */
export function CostRankList({
  rows,
  format = fmtMoney,
  maxRows = 8,
  empty,
}: {
  rows: RankRow[] | null;
  format?: (value: number) => string;
  maxRows?: number;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const shown = useMemo(
    // Copied before sorting: these rows can be a query cache, and sorting in
    // place would reorder what every other reader of that cache sees.
    () =>
      rankBarGeometry(
        [...(rows ?? [])].sort((a, b) => b.value - a.value).slice(0, maxRows),
      ),
    [rows, maxRows],
  );

  if (rows === null)
    return <EmptyPanel height="220px" unanswered empty={empty} />;
  if (shown.length === 0)
    return <EmptyPanel height="220px" unanswered={false} empty={empty} />;

  return (
    <VStack align="stretch" gap={2}>
      {shown.map((row) => (
        <HStack key={row.key} gap={3} fontSize="sm">
          {/* Half the row, because these labels are agent slugs and email
              addresses — `genie-revenue-analyst` and `genie-supply-planner`
              share a prefix long enough that a third of the row truncated
              them to the same string, and two rows that read alike are worse
              than a shorter bar. The full value is on hover either way. */}
          <Text flex="0 0 50%" minWidth={0} truncate title={row.label}>
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
              width={`${row.widthPct}%`}
              // The same number, readable without resolving styling — the
              // width above lands in a generated class name. `MeterBar` does
              // the same for the same reason.
              data-width-pct={row.widthPct}
              data-credit={row.isCredit ? "true" : undefined}
              // A credit is drawn as an outline rather than a fill, so a
              // refund and a charge of the same size do not read alike.
              backgroundColor={
                row.isCredit ? "transparent" : getHexColorForString(row.label)
              }
              borderWidth={row.isCredit ? "2px" : undefined}
              borderColor={
                row.isCredit ? getHexColorForString(row.label) : undefined
              }
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
      {/* Narrower than the legend beside it on purpose. The ring carries the
          shape of the split and needs no more than this to do it; the names
          are what a reader has to actually read, and every pixel here is one
          the labels lose. */}
      <Box width="120px" height="180px" flexShrink={0}>
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
              contentStyle={CHART_TOOLTIP_CONTENT}
              labelStyle={CHART_TOOLTIP_LABEL}
            />
          </PieChart>
        </ResponsiveContainer>
      </Box>
      {/* `minWidth={0}` here as well as on the rows: this VStack is itself a
          flex item, and its default minimum is the width of its widest row.
          Without it the legend refuses to narrow and pushes its own right
          edge outside the panel, which is what cut the percentages off. */}
      <VStack align="stretch" gap={1.5} flex="1" minWidth={0} fontSize="xs">
        {shown.map((row) => (
          <HStack key={row.key} gap={2} minWidth={0}>
            <Box
              width="8px"
              height="8px"
              borderRadius="full"
              flexShrink={0}
              backgroundColor={getHexColorForString(row.label)}
            />
            {/* `minWidth={0}` is what makes the truncation actually happen. A
                flex item's default minimum is its content width, so without
                this the label refuses to shrink and shoves the two figures
                past the panel's right edge — which is how "52%" came out as
                "52" and "3%" lost half of itself. */}
            <Text truncate title={row.label} flex="1" minWidth={0}>
              {row.label}
            </Text>
            <Text fontVariantNumeric="tabular-nums" flexShrink={0}>
              {fmtMoney(row.value)}
            </Text>
            {/* Wide enough for "100%", which is what a single-agent tenant
                shows on its first day. */}
            <Text
              color="fg.muted"
              flex="0 0 38px"
              flexShrink={0}
              textAlign="right"
              fontVariantNumeric="tabular-nums"
            >
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

/**
 * Stacked bars over the time axis — the shape the cost-evolution panels want.
 *
 * `grouped` puts the series side by side instead of on top of one another, for
 * the one panel whose series must never be added together: seats bought
 * against seats assigned. Stacking those draws a bar of bought-plus-assigned,
 * a height nobody holds, and the gap between them is the whole point of the
 * chart (ADR-128 §16).
 */
export function CostStackedBars({
  buckets,
  height = "220px",
  format = fmtMoney,
  showLegend = true,
  interval,
  grouped = false,
  empty,
}: {
  buckets: DailyBucket[] | null;
  height?: string;
  format?: (value: number) => string;
  showLegend?: boolean;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** Draw the series side by side rather than summed into one bar. */
  grouped?: boolean;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const keys = useMemo(() => seriesKeysOf(buckets ?? []), [buckets]);
  const rows = useMemo(
    () => widenBuckets(buckets ?? [], keys),
    [buckets, keys],
  );

  if (buckets === null)
    return <EmptyPanel height={height} unanswered empty={empty} />;
  // A window can come back full of days and empty of series — every day
  // present, nothing spent on any of them. That has rows but nothing to draw,
  // and drawing it anyway leaves bare axes that read as a broken chart.
  if (rows.length === 0 || keys.length === 0)
    return <EmptyPanel height={height} unanswered={false} empty={empty} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value, name) => [
              format(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => formatDayTick(label as string, interval)}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
            cursor={CHART_TOOLTIP_CURSOR}
          />
          {showLegend && ChartLegend({ keys })}
          {keys.map((k) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              // No stack id at all when grouped: recharts reads a shared one
              // as "these add up", which is exactly the claim the seat chart
              // must not make.
              stackId={grouped ? undefined : "cost"}
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
  interval,
}: {
  buckets: DailyBucket[];
  projectedFromDay: string | null;
  height?: string;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
}) {
  const keys = useMemo(() => seriesKeysOf(buckets), [buckets]);
  const rows = useMemo(() => widenBuckets(buckets, keys), [buckets, keys]);
  const lastDay = rows[rows.length - 1]?.day;

  if (rows.length === 0 || keys.length === 0)
    return <EmptyPanel height={height} unanswered={false} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={CHART_MARGIN}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            vertical={false}
          />
          <XAxis
            dataKey="day"
            tick={AXIS_TICK}
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={fmtMoney} width={58} />
          <Tooltip
            formatter={(value, name) => [
              fmtMoney(Number(value)),
              keys.find((k) => k.key === String(name))?.label ?? String(name),
            ]}
            labelFormatter={(label) => formatDayTick(label as string, interval)}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
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
  interval,
  empty,
}: {
  points: Array<{ day: string; value: number }>;
  height?: string;
  format?: (value: number) => string;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  if (points.length === 0)
    return <EmptyPanel height={height} unanswered={false} empty={empty} />;

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={CHART_MARGIN}>
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
            tickFormatter={(day) => formatDayTick(day, interval)}
            minTickGap={24}
          />
          <YAxis tick={AXIS_TICK} tickFormatter={format} width={58} />
          <Tooltip
            formatter={(value) => format(Number(value))}
            labelFormatter={(label) => formatDayTick(label as string, interval)}
            contentStyle={CHART_TOOLTIP_CONTENT}
            labelStyle={CHART_TOOLTIP_LABEL}
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
