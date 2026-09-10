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
  CHART_SPARK_STROKE,
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
 * A count spelled out in full, thousands separated.
 *
 * For the things a reader could in principle count: conversations, seats,
 * people. Tokens get `fmtCount` and its `k`/`M` suffixes because nobody holds
 * a token count in their head and the magnitude is the only part that matters.
 * Using the abbreviating formatter for both put "4.6k" on the conversations
 * axis directly beside "3.4B" on the tokens one, which made a few thousand
 * support chats look like a unit of machine throughput.
 */
export function fmtWhole(value: number): string {
  return numeral(value).format("0,0");
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
 * A row whose figure is WITHHELD draws no bar and does not set the scale.
 * There is no bar length that means "we do not know", and its placeholder
 * `value` is not a measurement — letting it into the scale would size every
 * other bar against a number nobody measured.
 *
 * Extracted from the panel because the width lands in a generated class name
 * that jsdom cannot resolve, which leaves the arithmetic untestable through
 * the rendered output.
 */
export function rankBarGeometry(rows: RankRow[]): RankBar[] {
  const scale = rows.reduce(
    (max, row) => (row.unpriced ? max : Math.max(max, Math.abs(row.value))),
    0,
  );
  return rows.map((row) => ({
    ...row,
    widthPct:
      row.unpriced || scale <= 0 ? 0 : (Math.abs(row.value) / scale) * 100,
    isCredit: !row.unpriced && row.value < 0,
  }));
}

/**
 * The bar half of a ranked row.
 *
 * Its own component for the reason `CostSpenderPanel` splits `SpenderBar` out:
 * the branch on a credit touches five properties, and inlined it buries the
 * row's shape under styling the row does not decide.
 */
function RankBarCell({ row }: { row: RankBar }) {
  return (
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
        // The same number, readable without resolving styling — the width
        // above lands in a generated class name. `MeterBar` does the same for
        // the same reason.
        data-width-pct={row.widthPct}
        data-credit={row.isCredit ? "true" : undefined}
        // A credit is drawn as an outline rather than a fill, so a refund and
        // a charge of the same size do not read alike.
        backgroundColor={
          row.isCredit ? "transparent" : getHexColorForString(row.label)
        }
        borderWidth={row.isCredit ? "2px" : undefined}
        borderColor={row.isCredit ? getHexColorForString(row.label) : undefined}
      />
    </Box>
  );
}

/**
 * The figure half of a ranked row, or the dash that stands in for one.
 *
 * A WITHHELD figure prints no number. Formatting its placeholder would put
 * "$0" where the screen means "we hold rows we cannot price", and the two
 * readings are not close enough for a reader to tell apart.
 */
function RankFigure({
  row,
  format,
}: {
  row: RankBar;
  format: (value: number) => string;
}) {
  return (
    <Text
      flex="0 0 18%"
      textAlign="right"
      fontVariantNumeric="tabular-nums"
      // Readable without resolving styling, as `data-width-pct` is: an em dash
      // alone cannot tell a test which of the two things it means, and the
      // reason is what a reader is owed here.
      data-unpriced={row.unpriced ? "true" : undefined}
      color={row.unpriced ? "fg.muted" : undefined}
      // The word the dash stands for, since the column is too narrow to print
      // it. Same sentence the spender panel uses for the same withholding, so
      // the two panels do not explain it differently.
      title={
        row.unpriced
          ? `unpriced — ${row.unpricedCells ?? 0} of this row's cells hold no US-dollar figure, so no total is shown`
          : undefined
      }
    >
      {row.unpriced ? "—" : format(row.value)}
    </Text>
  );
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
    //
    // WITHHELD rows sort last whatever their placeholder value says. Ranking
    // them by it would file a row nobody could price among the figures, and
    // its stand-in zero would land it above every credit on the panel.
    () =>
      rankBarGeometry(
        [...(rows ?? [])]
          .sort(
            (a, b) =>
              Number(a.unpriced ?? false) - Number(b.unpriced ?? false) ||
              b.value - a.value,
          )
          .slice(0, maxRows),
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
          <RankBarCell row={row} />
          <RankFigure row={row} format={format} />
        </HStack>
      ))}
    </VStack>
  );
}

/**
 * Donut with the breakdown listed beside it. The list carries the figures, so
 * the ring itself needs no labels.
 */
export function CostDonut({
  rows,
  empty,
}: {
  rows: RankRow[] | null;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const shown = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.value - a.value).slice(0, 8),
    [rows],
  );
  const total = shown.reduce((sum, row) => sum + row.value, 0);

  if (rows === null)
    return <EmptyPanel height="220px" unanswered empty={empty} />;
  // A ring of nothing is not a ring. Zero total covers both no rows at all
  // and rows that all came to zero, and neither draws.
  if (total === 0)
    return <EmptyPanel height="220px" unanswered={false} empty={empty} />;

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
  colorFor,
  empty,
  onSelectSeries,
}: {
  buckets: DailyBucket[] | null;
  height?: string;
  format?: (value: number) => string;
  showLegend?: boolean;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** Draw the series side by side rather than summed into one bar. */
  grouped?: boolean;
  /**
   * A colour for a series, overriding the label's hash.
   *
   * The hash is right for panels whose series are open-ended — teams, models,
   * agents — because it gives the same name the same hue on every screen. It
   * is wrong for a chart of exactly two series that exist to be compared:
   * "Seats bought" and "Seats assigned" hashed to two blues a reader had to
   * consult the legend to separate, on the one chart whose entire content is
   * the gap between them.
   */
  colorFor?: (key: string) => string | undefined;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
  /**
   * Called with a series key and a bucket when a reader clicks that series in
   * that bucket. Unset on every panel that has nothing to open, which is most
   * of them, and the bars then carry no pointer and no handler at all.
   *
   * The bar is the target rather than a row of controls under the chart: a
   * reader chasing a bucket that stands out is already pointing at it, and a
   * control row under a chart is a shape nothing else on this screen has.
   */
  onSelectSeries?: (key: string, bucket: string) => void;
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
              fill={colorFor?.(k.key) ?? getHexColorForString(k.label)}
              isAnimationActive={false}
              cursor={onSelectSeries ? "pointer" : undefined}
              onClick={
                onSelectSeries
                  ? (data) => {
                      // The widened row rides along as `payload`, so the
                      // bucket comes off the row itself rather than out of an
                      // index into `rows` — an index would silently point at
                      // the wrong bucket the moment a series is missing from
                      // one. Read through a cast because recharts types the
                      // payload as the chart's own row shape, which is a
                      // string-keyed bag it cannot narrow for us.
                      const day = (data as { payload?: { day?: unknown } })
                        ?.payload?.day;
                      if (typeof day === "string") onSelectSeries(k.key, day);
                    }
                  : undefined
              }
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

/** Opacity of a series over the months that were actually measured. */
const MEASURED_FILL = 0.42;
/** Opacity of the same series over the months still to come. */
const PROJECTED_FILL = 0.07;
/** The projected span's own wash, over the top of the faded series. */
const PROJECTION_INK = "#94a3b8";

/**
 * Where the projection begins: the LAST MEASURED bucket, and its position as a
 * fraction of the plot's width.
 *
 * ANCHORING ON THE MEASURED SIDE is what makes the region visible at all. A
 * category axis puts each bucket at a point, so a projection of one bucket —
 * which is what a quarter ahead folds to on a screen set to Quarter — has no
 * width: shading from the first projected bucket to the last ran from the last
 * point to the last point and drew nothing at all, which is the complaint this
 * rework began with.
 *
 * The segment between two points belongs to neither of its ends alone, so one
 * of them has to claim it. The measured side claims it, which draws a little of
 * what is known as though it were forecast. That is the direction the marker's
 * own fold already rounds, and for the same reason: showing a projection as
 * spend is the error worth engineering against, and calling a few measured days
 * projected only costs the reader some certainty.
 *
 * Null when nothing is projected, when the boundary names no bucket the chart
 * draws, or when there is no measured bucket to leave from. The chart then says
 * nothing about a projection rather than shading a span it cannot justify.
 */
function projectionSpan(
  rows: Array<Record<string, number | string>>,
  projectedFromDay: string | null,
): { from: string; at: number } | null {
  if (!projectedFromDay || rows.length < 2) return null;
  const first = rows.findIndex((row) => row.day === projectedFromDay);
  if (first <= 0) return null;
  const from = rows[first - 1]?.day;
  if (from === undefined) return null;
  return { from: String(from), at: (first - 1) / (rows.length - 1) };
}

/**
 * An id safe to hang a `<defs>` entry on. Series keys are agent names and
 * model names, which are free to carry characters a URL reference is not.
 */
function defsId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * The paints the forecast chart draws with: one fill gradient and one stroke
 * gradient per series, plus the hatch laid over the projected span.
 *
 * Called as a plain function, not rendered as `<ForecastDefs />`, for the same
 * reason `ChartLegend` is — recharts inspects the type of each direct child to
 * decide what it is, and a wrapper component is not a `defs` as far as that
 * inspection goes.
 *
 * `splitAt` is where the projection begins as a fraction of the plot's width.
 * TWO STOPS AT THAT ONE OFFSET is what makes it a hard edge rather than a
 * fade: the reader should see where measurement stopped, not a slow dissolve
 * that leaves the boundary a matter of opinion. With nothing projected the
 * split sits at 1 and every series is solid all the way across.
 */
function ForecastDefs({
  keys,
  splitAt,
}: {
  keys: Array<{ key: string; label: string }>;
  splitAt: number | null;
}) {
  const edge = splitAt ?? 1;
  return (
    <defs>
      {keys.map((k) => {
        const color = getHexColorForString(k.label);
        return (
          <linearGradient
            key={k.key}
            id={defsId("cost-forecast-fill", k.key)}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset={0} stopColor={color} stopOpacity={MEASURED_FILL} />
            <stop offset={edge} stopColor={color} stopOpacity={MEASURED_FILL} />
            <stop
              offset={edge}
              stopColor={color}
              stopOpacity={PROJECTED_FILL}
            />
            <stop offset={1} stopColor={color} stopOpacity={PROJECTED_FILL} />
          </linearGradient>
        );
      })}
      {keys.map((k) => {
        const color = getHexColorForString(k.label);
        return (
          <linearGradient
            key={k.key}
            id={defsId("cost-forecast-line", k.key)}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset={0} stopColor={color} stopOpacity={1} />
            <stop offset={edge} stopColor={color} stopOpacity={1} />
            <stop offset={edge} stopColor={color} stopOpacity={0.4} />
            <stop offset={1} stopColor={color} stopOpacity={0.4} />
          </linearGradient>
        );
      })}
      <pattern
        id="cost-forecast-hatch"
        width={6}
        height={6}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={6}
          stroke={PROJECTION_INK}
          strokeWidth={1}
          strokeOpacity={0.35}
        />
      </pattern>
    </defs>
  );
}

/**
 * Stacked area over the measured months and the months still to come.
 *
 * TELLING THE TWO APART IS THE WHOLE JOB. The panel used to draw both halves
 * in one flat fill and rely on a dashed line and the word "projected" to say
 * which was which — a caption doing work the drawing should do, and a reader
 * skimming the row saw one continuous block of spend running past today. The
 * two regions are now different objects to the eye before any label is read:
 * each series is filled through a gradient that drops hard at the boundary,
 * so the projected months are ghosted against solid measured ones, and the
 * projected span carries a diagonal hatch over the top of it.
 *
 * The hatch is the older convention and the one that survives a screenshot at
 * any size: fills flatten when an image is scaled down, and a texture does
 * not. Both signals rather than either, because this chart says money will be
 * spent that has not been, and that claim should be hard to miss.
 *
 * The gradient offsets are computed from the boundary's INDEX, not its date:
 * a category axis spaces its points evenly, so the split sits at a known
 * fraction of the plot's width whatever the interval folds the months into.
 */
/**
 * One stacked area per series, each painted from the gradients `ForecastDefs`
 * laid down for it.
 *
 * Returns the ARRAY rather than a fragment, and is called as a plain function
 * rather than rendered as `<ForecastAreas />`. Recharts inspects the type of
 * each child of a chart to decide what it is; an array it walks through, but
 * a fragment or a wrapper component is not an `Area` as far as that
 * inspection is concerned, and the series silently vanish.
 */
function forecastAreas(keys: Array<{ key: string; label: string }>) {
  return keys.map((k) => (
    <Area
      key={k.key}
      type="monotone"
      dataKey={k.key}
      stackId="cost"
      stroke={`url(#${defsId("cost-forecast-line", k.key)})`}
      strokeWidth={1.5}
      fill={`url(#${defsId("cost-forecast-fill", k.key)})`}
      fillOpacity={1}
      isAnimationActive={false}
    />
  ));
}

export function CostForecastArea({
  buckets,
  projectedFromDay,
  height = "220px",
  interval,
  empty,
}: {
  /** Null is a read that never answered; empty is one that found nothing. */
  buckets: DailyBucket[] | null;
  projectedFromDay: string | null;
  height?: string;
  /** The bucket width in view, which the time axis is ticked by. */
  interval?: TimeInterval;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const drawn = buckets ?? [];
  const keys = useMemo(() => seriesKeysOf(drawn), [drawn]);
  const rows = useMemo(() => widenBuckets(drawn, keys), [drawn, keys]);
  const projection = useMemo(
    () => projectionSpan(rows, projectedFromDay),
    [projectedFromDay, rows],
  );
  const lastDay = rows[rows.length - 1]?.day;
  const splitAt = projection?.at ?? null;
  if (buckets === null || rows.length === 0 || keys.length === 0)
    return (
      <EmptyPanel height={height} unanswered={buckets === null} empty={empty} />
    );

  return (
    <Box height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={CHART_MARGIN}>
          {ForecastDefs({ keys, splitAt })}
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
          {projection && lastDay && (
            <ReferenceArea
              x1={projection.from}
              x2={String(lastDay)}
              fill="url(#cost-forecast-hatch)"
              fillOpacity={1}
            />
          )}
          {projection && (
            <ReferenceLine
              x={projection.from}
              stroke={PROJECTION_INK}
              strokeDasharray="4 4"
              label={{
                value: "projected",
                position: "insideTopRight",
                fontSize: 10,
                fill: PROJECTION_INK,
              }}
            />
          )}
          {forecastAreas(keys)}
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
              <stop
                offset="0%"
                stopColor={CHART_SPARK_STROKE}
                stopOpacity={0.35}
              />
              <stop
                offset="100%"
                stopColor={CHART_SPARK_STROKE}
                stopOpacity={0.03}
              />
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
            stroke={CHART_SPARK_STROKE}
            strokeWidth={1.5}
            fill="url(#cost-line-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
