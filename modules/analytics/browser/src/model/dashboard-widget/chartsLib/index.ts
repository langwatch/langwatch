/**
 * `@langwatch/charts`, bundled into the sandboxed frame as `window.LWCharts` (see
 * `chart-frame-document.ts`). Reads `window.React`/`window.Recharts` so hooks share the author's
 * instance. How it keeps missing data off the screen: features/dashboards/WIDGET_STANDARD.md.
 */

import type { QueryCompleteness } from "@langwatch/analytics-contract";
import type * as RechartsLibrary from "recharts";

import { parseIsoInstant, utcParts } from "./utc-instant.ts";

type Row = Record<string, unknown>;

interface LWGlobal {
  dashboardContext?: { colors?: Readonly<Record<string, string>> };
  navigate?: (target: string, params?: Record<string, unknown>) => void;
}

/** The one member of the frame's React the charts call; every element type arrives untyped. */
interface FrameReact {
  createElement(type: unknown, props: unknown, ...children: unknown[]): unknown;
}

declare const window: {
  React: FrameReact;
  Recharts: typeof RechartsLibrary;
  LW?: LWGlobal;
};

// ---------------------------------------------------------------------------
// Theme + color helpers
// ---------------------------------------------------------------------------

const DEFAULT_HEIGHT = 240;

/** Resolved by the host before crossing the opaque iframe boundary. */
function token(name: string): string {
  const value = window.LW?.dashboardContext?.colors?.[name];
  if (!value) throw new Error(`Missing chart colour token: ${name}`);
  return value;
}

function chrome() {
  return {
    text: token("fg"),
    axis: token("fg.subtle"),
    grid: token("border.muted"),
    tooltipBg: token("bg.card"),
    tooltipBorder: token("border.card"),
  };
}

function paletteFor(colors?: string[]): string[] {
  return colors && colors.length > 0
    ? colors
    : Array.from({ length: 8 }, (_, index) => token(`chart.${index + 1}`));
}

function colorAt(colors: string[], index: number): string {
  return colors[index % colors.length] as string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

type MetricFormat = "number" | "currency" | "percent" | "duration";

/** True when a value is missing or not a usable number (null/undefined/NaN). */
function isMissingNumber(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "number" && isNaN(value));
}

function formatNumber(value: number | null | undefined): string {
  if (isMissingNumber(value)) return "–";
  return (value as number).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function formatDuration(ms: number | null | undefined): string {
  if (isMissingNumber(ms)) return "–";
  if (!isFinite(ms as number)) return String(ms);
  if (Math.abs(ms as number) < 1000) return `${Math.round(ms as number)}ms`;
  if (Math.abs(ms as number) < 60000) return `${((ms as number) / 1000).toFixed(1)}s`;
  return `${((ms as number) / 60000).toFixed(1)}m`;
}

function formatValue(value: number | string | null | undefined, format?: MetricFormat): string {
  if (typeof value === "string") return value;
  if (isMissingNumber(value)) return "–";
  switch (format) {
    case "currency":
      return `$${formatNumber(value)}`;
    case "percent":
      return `${formatNumber((value as number) * 100)}%`;
    case "duration":
      return formatDuration(value);
    case "number":
    default:
      return formatNumber(value);
  }
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function columnsOf(data: Row[]): string[] {
  return data[0] ? Object.keys(data[0]) : [];
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" && !isNaN(value);
}

function parseInstantEpochMs(value: unknown): number | undefined {
  return typeof value === "string" ? parseIsoInstant(value) : undefined;
}

/** A column reads as time-like by name, or by its first value parsing as a date. */
function isTimeLikeColumn(data: Row[], key: string): boolean {
  if (/date|time|timestamp|day|hour|week|month|bucket/i.test(key)) return true;
  const sample = data[0]?.[key];
  if (parseInstantEpochMs(sample) !== undefined) return true;
  return false;
}

/**
 * Axis tick formatter for an XAxis's `dataKey`. Time-like columns render as
 * "MM-DD" when the series spans more than one calendar day, else "HH:mm";
 * everything else (and unparsable values) falls back to the raw string.
 */
function axisTickFormatter(key: string, data: Row[]): (value: unknown) => string {
  const timeLike = isTimeLikeColumn(data, key);
  let spansMultipleDays = false;
  if (timeLike) {
    const times = data
      .map((row) => parseInstantEpochMs(row[key]))
      .filter((t): t is number => t !== undefined);
    if (times.length > 0) {
      spansMultipleDays = Math.max(...times) - Math.min(...times) > 24 * 60 * 60 * 1000;
    }
  }
  return (value: unknown): string => {
    const raw = String(value);
    if (!timeLike) return raw;
    const instant = parseInstantEpochMs(raw);
    if (instant === undefined) return raw;
    const date = utcParts(instant);
    if (spansMultipleDays) {
      const mm = String(date.month).padStart(2, "0");
      const dd = String(date.day).padStart(2, "0");
      return `${mm}-${dd}`;
    }
    const hh = String(date.hour).padStart(2, "0");
    const min = String(date.minute).padStart(2, "0");
    return `${hh}:${min}`;
  };
}

/** Compact-notation number formatter for a YAxis, null-safe like formatNumber. */
function compactNumber(value: unknown): string {
  if (isMissingNumber(value)) return "";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value as number);
}

function numericColumns(data: Row[], exclude: string[]): string[] {
  const cols = columnsOf(data);
  return cols.filter((col) => !exclude.includes(col) && data.some((row) => isNumeric(row[col])));
}

/** A value as a number, or null when it is missing: a gap is never drawn as 0. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Buckets: every bucket of the window, from the query's completeness report
// ---------------------------------------------------------------------------

/** A count may be a real 0; a measure (rate, average, percentile) with no data is a gap. */
export type SeriesKind = "count" | "measure";

/** A series key, or a key with its kind. A bare key is a measure, the safe default. */
export type SeriesSpec = string | { key: string; kind?: SeriesKind };

export interface CompletenessBucket {
  start: string;
  n: number;
}

/** `2026-10-07 00:00:00[.000]` as LangWatchQL returns it, read as UTC. */
const CLICKHOUSE_INSTANT = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/** A bucket value as epoch milliseconds; rows and the report spell instants differently. */
function bucketEpochMs(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const naive = CLICKHOUSE_INSTANT.exec(value.trim());
  return parseInstantEpochMs(naive ? `${naive[1]}T${naive[2]}Z` : value.trim());
}

function clickHouseInstant(epochMs: number): string {
  const utc = utcParts(epochMs);
  const two = (part: number) => String(part).padStart(2, "0");
  const date = `${utc.year}-${two(utc.month)}-${two(utc.day)}`;
  return `${date} ${two(utc.hour)}:${two(utc.minute)}:${two(utc.second)}`;
}

function seriesKey(spec: SeriesSpec): string {
  return typeof spec === "string" ? spec : spec.key;
}

function emptyBucketRow({
  x,
  epochMs,
  series,
}: {
  x: string;
  epochMs: number;
  series: readonly SeriesSpec[];
}): Row {
  const row: Row = { [x]: clickHouseInstant(epochMs) };
  for (const spec of series) {
    row[seriesKey(spec)] = typeof spec !== "string" && spec.kind === "count" ? 0 : null;
  }
  return row;
}

/**
 * The rows with every bucket of the window present, in time order: a bucket with no row gets
 * one, its count series 0 and its measure series null. Without buckets the rows come back as
 * they are. A row whose x is not an instant is kept, after the others.
 */
export function mergeBuckets({
  rows,
  buckets,
  x,
  series = [],
}: {
  rows: readonly Row[];
  buckets: readonly CompletenessBucket[] | null | undefined;
  x: string;
  series?: readonly SeriesSpec[];
}): Row[] {
  if (!buckets || buckets.length === 0) return [...rows];
  const byBucket = new Map<number, Row[]>();
  const unplaced: Row[] = [];
  for (const row of rows) {
    const epochMs = bucketEpochMs(row[x]);
    if (epochMs === undefined) {
      unplaced.push(row);
      continue;
    }
    byBucket.set(epochMs, [...(byBucket.get(epochMs) ?? []), row]);
  }
  for (const bucket of buckets) {
    const epochMs = bucketEpochMs(bucket.start);
    if (epochMs === undefined || byBucket.has(epochMs)) continue;
    byBucket.set(epochMs, [emptyBucketRow({ x, epochMs, series })]);
  }
  const placed = [...byBucket.entries()]
    .toSorted(([left], [right]) => left - right)
    .flatMap(([, bucketRows]) => bucketRows);
  return [...placed, ...unplaced];
}

/** Unpriced spans leave every cost sum short, whichever cost column the query reads. */
const COST_FIELD = /cost/i;

/**
 * Whether a sum over `field` is a lower bound, so its figure reads "$830+": the data is
 * partial and some rows lack the field, or it is a cost and some traces have no price.
 * Never put a "+" on an average or a rate.
 */
export function isLowerBound({
  completeness,
  field,
}: {
  completeness: QueryCompleteness | null | undefined;
  field: string;
}): boolean {
  if (completeness?.state !== "partial") return false;
  const present =
    completeness.fields.find((candidate) => candidate.field === field)?.present ??
    completeness.total;
  const unpriced = COST_FIELD.test(field) ? (completeness.unpriced?.count ?? 0) : 0;
  return present < completeness.total || unpriced > 0;
}

/**
 * The mean of `key` over the rows that have it, so an empty bucket never pulls a big number
 * down. With `weight` (a row count column), each row counts by its weight. Null when no row has
 * a value.
 */
export function averageOf({
  rows,
  key,
  weight,
}: {
  rows: readonly Row[];
  key: string;
  weight?: string;
}): number | null {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const value = toNumber(row[key]);
    const rowWeight = weight === undefined ? 1 : (toNumber(row[weight]) ?? 0);
    if (value === null || rowWeight <= 0) continue;
    total += value * rowWeight;
    count += rowWeight;
  }
  return count > 0 ? total / count : null;
}

/** Index of the first row whose x value is at/after `projectionFrom`. -1 if none. */
function projectionIndex(
  data: Row[],
  xKey: string,
  projectionFrom: string | number | undefined,
): number {
  if (projectionFrom === undefined) return -1;
  return data.findIndex((row) => {
    const value = row[xKey];
    if (typeof value === "number" && typeof projectionFrom === "number") {
      return value >= projectionFrom;
    }
    return String(value) === String(projectionFrom);
  });
}

// ---------------------------------------------------------------------------
// React / Recharts locals — resolved lazily inside each component so the
// module itself has no load-order dependency beyond React/Recharts having
// already run (guaranteed by the frame document.s script order).
// ---------------------------------------------------------------------------

/** A cell's text: primitives as written, anything structured as JSON, never `[object Object]`. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value) ?? "";
}

function react() {
  return window.React;
}

function recharts() {
  return window.Recharts;
}

function h(type: unknown, props: unknown, ...children: unknown[]) {
  return react().createElement(type, props, ...children);
}

/**
 * A wrapping legend row rendered above a chart in place of Recharts' own
 * `<Legend>`. Only meaningful with 2+ keys — callers gate on `keys.length > 1`.
 */
function legendBar(keys: string[], palette: string[], c: ReturnType<typeof chrome>) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "2px 12px",
        marginBottom: 4,
        fontSize: 10.5,
        color: c.text,
      },
    },
    ...keys.map((key, index) =>
      h(
        "div",
        { key, style: { display: "flex", alignItems: "center", gap: 4 } },
        h("span", {
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colorAt(palette, index),
            flexShrink: 0,
          },
        }),
        key,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export interface SparklineProps {
  data: Row[] | number[];
  x?: string;
  y?: string;
  color?: string;
  height?: number;
}

// A null point breaks the line: the chart never invents a 0 for a missing value.
function sparklinePoints(data: Row[] | number[], y?: string): { value: number | null }[] {
  if (data.length === 0) return [];
  if (!data.some((item) => typeof item === "object" && item !== null)) {
    return (data as unknown[]).map((value) => ({ value: toNumber(value) }));
  }
  const rows = data as Row[];
  const key = y ?? numericColumns(rows, [])[0];
  return rows.map((row) => ({ value: key ? toNumber(row[key]) : null }));
}

export function Sparkline({ data, y, color, height = 40 }: SparklineProps) {
  const R = recharts();
  const points = sparklinePoints(data, y);
  const stroke = color ?? paletteFor()[0];
  return h(
    R.ResponsiveContainer,
    { width: "100%", height },
    h(
      R.AreaChart,
      { data: points, margin: { top: 2, right: 2, bottom: 2, left: 2 } },
      h(R.Area, {
        type: "monotone",
        dataKey: "value",
        stroke,
        fill: stroke,
        fillOpacity: 0.15,
        strokeWidth: 1.5,
        dot: false,
        connectNulls: false,
        isAnimationActive: false,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// MetricStat
// ---------------------------------------------------------------------------

export interface MetricStatProps {
  value: number | string | null | undefined;
  label: string;
  delta?: number;
  deltaDirection?: "up" | "down";
  format?: MetricFormat;
  sparkline?: number[] | Row[];
  sparklineKey?: string;
  colors?: string[];
  height?: number;
}

export function MetricStat({
  value,
  label,
  delta,
  deltaDirection,
  format,
  sparkline,
  sparklineKey,
  colors,
  height,
}: MetricStatProps) {
  const c = chrome();
  const palette = paletteFor(colors);
  const deltaColor = token(deltaDirection === "down" ? "fg.error" : "fg.success");
  const deltaArrow = deltaDirection === "down" ? "▼" : "▲";
  const hasValue = typeof value === "string" || !isMissingNumber(value);

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column", gap: 4 } },
    h("div", { style: { fontSize: 12, color: c.axis } }, label),
    h(
      "div",
      {
        style: {
          fontSize: 24,
          fontWeight: 600,
          color: hasValue ? c.text : c.axis,
          lineHeight: 1.2,
        },
      },
      hasValue ? formatValue(value, format) : "No data",
    ),
    delta !== undefined &&
      h("div", { style: { fontSize: 12, color: deltaColor } }, `${deltaArrow} ${Math.abs(delta)}%`),
    sparkline &&
      h(Sparkline, {
        data: sparkline,
        y: sparklineKey,
        height: 32,
        color: palette[0],
      }),
  );
}

// ---------------------------------------------------------------------------
// AreaTimeseries
// ---------------------------------------------------------------------------

export interface AreaTimeseriesProps {
  data: Row[];
  x: string;
  series: string | string[];
  stacked?: boolean;
  projectionFrom?: string | number;
  colors?: string[];
  height?: number;
  /** How the hover prints a value. */
  format?: MetricFormat;
  /** What the hover says over a bucket with no data, from its date: "No evals ran on Oct 7". */
  gapLabel?: (date: string) => string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 7", or "Oct 7, 14:00" for a bucket that starts inside a day; UTC, as the axis is. */
function bucketDate(value: unknown): string {
  const epochMs = bucketEpochMs(value);
  if (epochMs === undefined) return cellText(value);
  const utc = utcParts(epochMs);
  const day = `${MONTHS[utc.month - 1]} ${utc.day}`;
  if (utc.hour === 0 && utc.minute === 0) return day;
  return `${day}, ${String(utc.hour).padStart(2, "0")}:${String(utc.minute).padStart(2, "0")}`;
}

const GAP_BRIDGE = "__gap";

/**
 * A two-point series across each gap of each key with a point on both sides, drawn as a faint
 * dashed line so the trend still reads where the area breaks.
 */
function withGapBridges({ rows, keys }: { rows: Row[]; keys: readonly string[] }): {
  rows: Row[];
  bridges: { key: string; of: number }[];
} {
  const bridged = rows.map((row) => ({ ...row }));
  const bridges: { key: string; of: number }[] = [];
  keys.forEach((key, of) => {
    let last = -1;
    bridged.forEach((row, index) => {
      const value = toNumber(row[key]);
      if (value === null) return;
      const before = bridged[last];
      if (before && index - last > 1) {
        const bridge = `${key}${GAP_BRIDGE}${bridges.length}`;
        before[bridge] = toNumber(before[key]);
        row[bridge] = value;
        bridges.push({ key: bridge, of });
      }
      last = index;
    });
  });
  return { rows: bridged, bridges };
}

/** The hover for a time chart: each series' value, "no data" for a gap, and the gap's own words. */
function gapAwareTooltip({
  keys,
  palette,
  format,
  gapLabel,
}: {
  keys: readonly string[];
  palette: string[];
  format?: MetricFormat;
  gapLabel: (date: string) => string;
}) {
  return ({
    active,
    label,
    payload,
  }: {
    active?: boolean;
    label?: unknown;
    payload?: readonly { payload?: Row }[];
  }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const c = chrome();
    const date = bucketDate(label);
    const box = {
      background: c.tooltipBg,
      border: `1px solid ${c.tooltipBorder}`,
      borderRadius: 6,
      padding: "6px 10px",
      fontSize: 12,
      color: c.text,
    };
    if (keys.every((key) => toNumber(row[key]) === null)) {
      return h("div", { style: { ...box, color: c.axis } }, gapLabel(date));
    }
    return h(
      "div",
      { style: box },
      h("div", { style: { fontSize: 11, color: c.axis, marginBottom: 2 } }, date),
      ...keys.map((key, index) => {
        const value = toNumber(row[key]);
        return h(
          "div",
          { key, style: { display: "flex", alignItems: "center", gap: 6 } },
          h("span", {
            style: {
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colorAt(palette, index),
            },
          }),
          h("span", { style: { color: c.axis } }, key),
          h(
            "span",
            {
              style: {
                marginLeft: "auto",
                paddingLeft: 12,
                fontWeight: value === null ? 400 : 600,
                color: value === null ? c.axis : c.text,
              },
            },
            value === null ? "no data" : formatValue(value, format),
          ),
        );
      }),
    );
  };
}

/**
 * Two Area layers per series (actual, projected) share a stackId so a stacked chart still
 * composes; only one of the pair is non-null at any x, except the seam row before the split,
 * where both carry the value so the line stays continuous across the boundary.
 */
function splitActualFromProjected({
  data,
  keys,
  splitAt,
}: {
  data: Row[];
  keys: string[];
  splitAt: number;
}): Row[] {
  return data.map((row, index) => {
    const isProjected = splitAt !== -1 && index >= splitAt;
    const isBoundary = splitAt !== -1 && index === splitAt - 1;
    const out: Row = { ...row };
    for (const key of keys) {
      out[`${key}__actual`] = !isProjected || isBoundary ? row[key] : null;
      out[`${key}__projected`] = isProjected || isBoundary ? row[key] : null;
    }
    return out;
  });
}

// One component computing series geometry and rendering the SVG chart together.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: geometry plus render.
export function AreaTimeseries({
  data,
  x,
  series,
  stacked,
  projectionFrom,
  colors,
  height = DEFAULT_HEIGHT,
  format,
  gapLabel = (date) => `No data on ${date}`,
}: AreaTimeseriesProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const keys = Array.isArray(series) ? series : [series];
  const splitAt = projectionIndex(data, x, projectionFrom);

  // A bridge over a stacked area would sit at its own value, not on the stack, so none there.
  const { rows, bridges } = withGapBridges({
    rows: splitActualFromProjected({ data, keys, splitAt }),
    keys: stacked ? [] : keys,
  });
  const bridgeLines = bridges.map((bridge) =>
    h(R.Line, {
      key: bridge.key,
      dataKey: bridge.key,
      stroke: colorAt(palette, bridge.of),
      strokeOpacity: 0.45,
      strokeWidth: 1.2,
      strokeDasharray: "3 3",
      dot: false,
      activeDot: false,
      connectNulls: true,
      legendType: "none",
      tooltipType: "none",
      isAnimationActive: false,
    }),
  );

  const areas = keys.flatMap((key, index) => {
    const color = colorAt(palette, index);
    const stackId = stacked ? "stack" : undefined;
    const commonProps = {
      type: "monotone" as const,
      stroke: color,
      fill: color,
      isAnimationActive: false,
      connectNulls: false,
      ...(stackId ? { stackId } : {}),
    };
    return [
      h(R.Area, {
        key: `${key}__actual`,
        dataKey: `${key}__actual`,
        name: key,
        fillOpacity: 0.25,
        strokeWidth: 2,
        ...commonProps,
      }),
      h(R.Area, {
        key: `${key}__projected`,
        dataKey: `${key}__projected`,
        name: `${key} (projected)`,
        fillOpacity: 0.1,
        strokeOpacity: 0.4,
        strokeDasharray: "4 3",
        strokeWidth: 2,
        ...commonProps,
      }),
    ];
  });

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    keys.length > 1 && legendBar(keys, palette, c),
    h(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.ComposedChart,
          { data: rows, margin: { top: 6, right: 8, bottom: 0, left: 0 } },
          h(R.CartesianGrid, { stroke: c.grid, vertical: false }),
          h(R.XAxis, {
            dataKey: x,
            axisLine: false,
            tickLine: false,
            minTickGap: 24,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: axisTickFormatter(x, data),
          }),
          h(R.YAxis, {
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: compactNumber,
          }),
          // filterNull off: a bucket with no data still hovers, to say so.
          h(R.Tooltip, {
            filterNull: false,
            content: gapAwareTooltip({ keys, palette, format, gapLabel }),
          }),
          ...bridgeLines,
          ...areas,
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// StackedBars / GroupedBars / ProjectionBars share a bar-cell renderer
// ---------------------------------------------------------------------------

/** A single series' <Bar>, with per-cell opacity for the projected region. */
function projectedBar(
  R: typeof RechartsLibrary,
  opts: {
    key: string;
    dataKey: string;
    color: string;
    stackId?: string;
    rowCount: number;
    splitAt: number;
  },
) {
  const { key, dataKey, color, stackId, rowCount, splitAt } = opts;
  const cells = Array.from({ length: rowCount }, (_unused, index) =>
    h(recharts().Cell, {
      key: index,
      fillOpacity: splitAt !== -1 && index >= splitAt ? 0.4 : 1,
    }),
  );
  return h(
    R.Bar,
    {
      key,
      dataKey,
      fill: color,
      isAnimationActive: false,
      ...(stackId ? { stackId } : {}),
    },
    ...cells,
  );
}

export interface StackedBarsProps {
  data: Row[];
  x: string;
  series: string[];
  projectionFrom?: string | number;
  colors?: string[];
  height?: number;
}

export function StackedBars({
  data,
  x,
  series,
  projectionFrom,
  colors,
  height = DEFAULT_HEIGHT,
}: StackedBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const splitAt = projectionIndex(data, x, projectionFrom);

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    series.length > 1 && legendBar(series, palette, c),
    h(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.BarChart,
          { data, margin: { top: 6, right: 8, bottom: 0, left: 0 } },
          h(R.CartesianGrid, { stroke: c.grid, vertical: false }),
          h(R.XAxis, {
            dataKey: x,
            axisLine: false,
            tickLine: false,
            minTickGap: 24,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: axisTickFormatter(x, data),
          }),
          h(R.YAxis, {
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: compactNumber,
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
          ...series.map((key, index) =>
            projectedBar(R, {
              key,
              dataKey: key,
              color: colorAt(palette, index),
              stackId: "stack",
              rowCount: data.length,
              splitAt,
            }),
          ),
        ),
      ),
    ),
  );
}

export interface GroupedBarsProps {
  data: Row[];
  x: string;
  series: string[];
  colors?: string[];
  height?: number;
}

export function GroupedBars({
  data,
  x,
  series,
  colors,
  height = DEFAULT_HEIGHT,
}: GroupedBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    series.length > 1 && legendBar(series, palette, c),
    h(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.BarChart,
          { data, margin: { top: 6, right: 8, bottom: 0, left: 0 } },
          h(R.CartesianGrid, { stroke: c.grid, vertical: false }),
          h(R.XAxis, {
            dataKey: x,
            axisLine: false,
            tickLine: false,
            minTickGap: 24,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: axisTickFormatter(x, data),
          }),
          h(R.YAxis, {
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: compactNumber,
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
          ...series.map((key, index) =>
            h(R.Bar, {
              key,
              dataKey: key,
              fill: colorAt(palette, index),
              isAnimationActive: false,
            }),
          ),
        ),
      ),
    ),
  );
}

export interface ProjectionBarsProps {
  data: Row[];
  x: string;
  y: string;
  projectionFrom: string | number;
  budget?: number;
  colors?: string[];
  height?: number;
}

export function ProjectionBars({
  data,
  x,
  y,
  projectionFrom,
  budget,
  colors,
  height = DEFAULT_HEIGHT,
}: ProjectionBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const splitAt = projectionIndex(data, x, projectionFrom);

  return h(
    R.ResponsiveContainer,
    { width: "100%", height },
    h(
      R.BarChart,
      { data, margin: { top: 6, right: 8, bottom: 0, left: 0 } },
      h(R.CartesianGrid, { stroke: c.grid, vertical: false }),
      h(R.XAxis, {
        dataKey: x,
        axisLine: false,
        tickLine: false,
        minTickGap: 24,
        tick: { fill: c.axis, fontSize: 11 },
        tickFormatter: axisTickFormatter(x, data),
      }),
      h(R.YAxis, {
        axisLine: false,
        tickLine: false,
        width: 48,
        tick: { fill: c.axis, fontSize: 11 },
        tickFormatter: compactNumber,
        // Auto-scaled domain can clip the budget's ReferenceLine when budget
        // exceeds the data's own max; pad the domain to always include it.
        domain:
          budget !== undefined
            ? [0, (dataMax: number) => Math.max(dataMax, budget * 1.1)]
            : undefined,
      }),
      h(R.Tooltip, {
        contentStyle: {
          background: c.tooltipBg,
          border: `1px solid ${c.tooltipBorder}`,
        },
        labelStyle: { color: c.text },
      }),
      budget !== undefined &&
        h(R.ReferenceLine, {
          y: budget,
          stroke: token("fg.error"),
          strokeDasharray: "4 3",
          label: {
            value: "Budget",
            position: "right",
            fill: token("fg.error"),
            fontSize: 11,
          },
        }),
      projectedBar(R, {
        key: y,
        dataKey: y,
        color: palette[0] as string,
        rowCount: data.length,
        splitAt,
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export interface DonutProps {
  data: Row[];
  nameKey: string;
  valueKey: string;
  centerLabel?: string;
  colors?: string[];
  height?: number;
}

export function Donut({
  data,
  nameKey,
  valueKey,
  centerLabel,
  colors,
  height = DEFAULT_HEIGHT,
}: DonutProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    data.length > 1 &&
      legendBar(
        data.map((row) => String(row[nameKey])),
        palette,
        c,
      ),
    h(
      "div",
      { style: { flex: 1, minHeight: 0, position: "relative", width: "100%" } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.PieChart,
          {},
          h(
            R.Pie,
            {
              data,
              dataKey: valueKey,
              nameKey,
              innerRadius: "55%",
              outerRadius: "80%",
              isAnimationActive: false,
            },
            ...data.map((_row, index) => h(R.Cell, { key: index, fill: colorAt(palette, index) })),
          ),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
        ),
      ),
      centerLabel &&
        h(
          "div",
          {
            style: {
              position: "absolute",
              top: "42%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center",
              fontSize: 13,
              fontWeight: 600,
              color: c.text,
              pointerEvents: "none",
            },
          },
          centerLabel,
        ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

/** Larger first, a missing value after every known one. */
function compareDescending(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
}

export interface LeaderboardProps {
  data: Row[];
  labelKey: string;
  valueKey: string;
  max?: number;
  format?: MetricFormat;
  height?: number;
  navigateTo?: { target: string; params: (row: Row) => object };
  /**
   * The report's unpriced models, for a cost list by model: each gets a "no price" row with a
   * dash for its cost, never $0, added when the data has no row for it.
   */
  unpriced?: { models: readonly string[] };
}

/** The rows with each unpriced model's value cleared, and a row for any model they lack. */
function withUnpricedRows({
  data,
  labelKey,
  valueKey,
  models,
}: {
  data: Row[];
  labelKey: string;
  valueKey: string;
  models: ReadonlySet<string>;
}): Row[] {
  const listed = new Set(data.map((row) => cellText(row[labelKey])));
  return [
    ...data.map((row) =>
      models.has(cellText(row[labelKey])) ? { ...row, [valueKey]: null } : row,
    ),
    ...[...models]
      .filter((model) => !listed.has(model))
      .map((model) => ({ [labelKey]: model, [valueKey]: null })),
  ];
}

export function Leaderboard({
  data,
  labelKey,
  valueKey,
  max,
  format,
  height,
  navigateTo,
  unpriced,
}: LeaderboardProps) {
  const c = chrome();
  const palette = paletteFor();
  const noPrice = new Set(unpriced?.models ?? []);
  const rows = withUnpricedRows({ data, labelKey, valueKey, models: noPrice });
  // Rows with no value sort last and draw no bar: a missing value is not a 0.
  const ranked = rows.toSorted((a, b) =>
    compareDescending(toNumber(a[valueKey]), toNumber(b[valueKey])),
  );
  const known = ranked
    .map((row) => toNumber(row[valueKey]))
    .filter((value): value is number => value !== null);
  const scaleMax = max ?? Math.max(1, ...known);

  return h(
    "div",
    {
      style: {
        height,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      },
    },
    ...ranked.map((row, index) => {
      const value = toNumber(row[valueKey]);
      const widthPct = value === null ? 0 : Math.max(2, Math.min(100, (value / scaleMax) * 100));
      const clickable = typeof navigateTo?.params === "function";
      return h(
        "div",
        {
          key: index,
          onClick: clickable
            ? () =>
                window.LW?.navigate?.(
                  navigateTo!.target,
                  navigateTo!.params(row) as Record<string, unknown>,
                )
            : undefined,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: clickable ? "pointer" : "default",
          },
        },
        h(
          "div",
          {
            style: { fontSize: 12, color: c.text, minWidth: 96, flexShrink: 0 },
          },
          cellText(row[labelKey]),
          noPrice.has(cellText(row[labelKey])) &&
            h("span", { style: { marginLeft: 6, color: c.axis } }, "no price"),
        ),
        h(
          "div",
          {
            style: { flex: 1, background: c.grid, borderRadius: 3, height: 10 },
          },
          h("div", {
            style: {
              width: `${widthPct}%`,
              height: "100%",
              borderRadius: 3,
              background: colorAt(palette, index),
            },
          }),
        ),
        h(
          "div",
          {
            style: {
              fontSize: 12,
              color: c.axis,
              minWidth: 48,
              textAlign: "right",
            },
          },
          formatValue(value, format),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

const DEFAULT_HOUR_LABELS = Array.from({ length: 24 }, (_unused, i) => String(i));
const DEFAULT_WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface HeatmapProps {
  data: Row[];
  xKey: string;
  yKey: string;
  valueKey: string;
  xLabels?: string[];
  yLabels?: string[];
  colorScale?: [string, string];
  /** "count": a cell with no row is 0. "measure" (default): it is a gap, drawn empty. */
  kind?: SeriesKind;
  height?: number;
}

/** The default heatmap scale, also the fallback for an unparsable colorScale. */
const heatmapScale = (): [string, string] => [token("blue.subtle"), token("blue.solid")];

/**
 * Parses `#rgb`/`#rrggbb` to an [r, g, b] triple, or null. Author `colorScale` is Babel-compiled
 * with no type checking, so a 3-digit shorthand reaches here as ordinary CSS -- expand it rather
 * than let `parseInt("", 16)` produce NaN and blank every cell.
 */
export function parseHexRgb(hex: string): [number, number, number] | null {
  const body = hex.trim().replace("#", "");
  const full =
    body.length === 3
      ? body
          .split("")
          .map((char) => char + char)
          .join("")
      : body;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function interpolateColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] = parseHexRgb(from) ?? parseHexRgb(token("blue.subtle"))!;
  const [r2, g2, b2] = parseHexRgb(to) ?? parseHexRgb(token("blue.solid"))!;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

export function Heatmap({
  data,
  xKey,
  yKey,
  valueKey,
  xLabels,
  yLabels,
  colorScale,
  kind = "measure",
  height = DEFAULT_HEIGHT,
}: HeatmapProps) {
  const c = chrome();
  const cols = xLabels ?? (xKey === "hour" ? DEFAULT_HOUR_LABELS : undefined);
  const rows = yLabels ?? (yKey === "weekday" ? DEFAULT_WEEKDAY_LABELS : undefined);
  const xValues = cols ?? Array.from(new Set(data.map((row) => String(row[xKey]))));
  const yValues = rows ?? Array.from(new Set(data.map((row) => String(row[yKey]))));
  const scale = colorScale ?? heatmapScale();
  const values = data
    .map((row) => toNumber(row[valueKey]))
    .filter((value): value is number => value !== null);
  const maxValue = Math.max(1, ...values);
  const absent = kind === "count" ? 0 : null;

  const lookup = new Map<string, number | null>();
  data.forEach((row) => {
    lookup.set(`${String(row[xKey])}\u0000${String(row[yKey])}`, toNumber(row[valueKey]));
  });

  return h(
    "div",
    { style: { height, overflow: "auto" } },
    h(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: `repeat(${xValues.length}, minmax(16px, 1fr))`,
          gap: 2,
        },
      },
      ...yValues.flatMap((yValue, yIndex) =>
        xValues.map((xValue, xIndex) => {
          const cell = `${xValue}\u0000${yValue}`;
          const raw = lookup.has(cell) ? (lookup.get(cell) ?? null) : absent;
          if (raw === null) {
            return h("div", {
              key: `${yIndex}-${xIndex}`,
              title: `${yValue} / ${xValue}: no data`,
              style: { aspectRatio: "1", borderRadius: 2, border: `1px dashed ${c.grid}` },
            });
          }
          const t = maxValue > 0 ? raw / maxValue : 0;
          return h("div", {
            key: `${yIndex}-${xIndex}`,
            title: `${yValue} / ${xValue}: ${raw}`,
            style: {
              aspectRatio: "1",
              borderRadius: 2,
              background: interpolateColor(scale[0], scale[1], t),
            },
          });
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Table (internal — LwqlChart's fallback kind; not exported on its own)
// ---------------------------------------------------------------------------

function Table({ data, height }: { data: Row[]; height?: number }) {
  const c = chrome();
  const cols = columnsOf(data);
  return h(
    "div",
    { style: { height, overflow: "auto" } },
    h(
      "table",
      { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...cols.map((col) =>
            h(
              "th",
              {
                key: col,
                style: {
                  textAlign: "left",
                  borderBottom: `1px solid ${c.grid}`,
                  padding: "4px 8px",
                  color: c.axis,
                  fontWeight: 500,
                },
              },
              col,
            ),
          ),
        ),
      ),
      h(
        "tbody",
        {},
        ...data.map((row, rowIndex) =>
          h(
            "tr",
            { key: rowIndex },
            ...cols.map((col) =>
              h(
                "td",
                {
                  key: col,
                  style: {
                    borderBottom: `1px solid ${c.grid}`,
                    padding: "4px 8px",
                    color: c.text,
                  },
                },
                isMissingNumber(row[col]) ? "–" : cellText(row[col]),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// LwqlChart — auto-picker
// ---------------------------------------------------------------------------

export type LwqlChartKind = "area" | "bars" | "donut" | "leaderboard" | "table";

export interface LwqlChartProps {
  data: Row[];
  kind?: LwqlChartKind;
  x?: string;
  y?: string | string[];
  series?: string;
  colors?: string[];
  height?: number;
  /** The report's unpriced models; a leaderboard lists each with "no price". */
  unpriced?: { models: readonly string[] };
}

interface InferredShape {
  kind: LwqlChartKind;
  x: string;
  y: string[];
}

function asColumnList(y: string | string[]): string[] {
  return Array.isArray(y) ? y : [y];
}

// Independent shape-detection rules over the data's columns; branches don't interact.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent rules.
function inferShape(data: Row[], x?: string, y?: string | string[]): InferredShape {
  const cols = columnsOf(data);
  const explicitX = x ?? cols[0];
  const explicitY = y ? asColumnList(y) : numericColumns(data, explicitX ? [explicitX] : []);

  if (explicitX && isTimeLikeColumn(data, explicitX)) {
    return {
      kind: explicitY.length > 1 ? "bars" : "area",
      x: explicitX,
      y: explicitY,
    };
  }

  // name+value shape: exactly one non-numeric column (the name) and one
  // numeric column (the value), regardless of declared order.
  const numeric = numericColumns(data, []);
  if (cols.length === 2 && numeric.length === 1) {
    const nameKey = cols.find((col) => col !== numeric[0]) as string;
    return {
      kind: data.length <= 8 ? "donut" : "leaderboard",
      x: nameKey,
      y: numeric,
    };
  }

  return { kind: "table", x: explicitX ?? cols[0] ?? "", y: explicitY };
}

/**
 * Picks a concrete component from `data`'s shape (or the caller's explicit `kind`/`x`/`y`/
 * `series`) and renders it -- see the file header and the per-kind rules in this module.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent fallbacks.
export function LwqlChart({
  data,
  kind,
  x,
  y,
  series,
  colors,
  height = DEFAULT_HEIGHT,
  unpriced,
}: LwqlChartProps) {
  const inferred = inferShape(data, x, y);
  const resolvedKind = kind ?? inferred.kind;
  const resolvedX = x ?? inferred.x;
  const resolvedY = y ? asColumnList(y) : inferred.y;

  switch (resolvedKind) {
    case "area":
      return h(AreaTimeseries, {
        data,
        x: resolvedX,
        series: series ?? resolvedY,
        colors,
        height,
      });
    case "bars":
      return h(StackedBars, {
        data,
        x: resolvedX,
        series: series ? [series] : resolvedY,
        colors,
        height,
      });
    case "donut":
      return h(Donut, {
        data,
        nameKey: resolvedX,
        valueKey: (resolvedY[0] as string) ?? "",
        colors,
        height,
      });
    case "leaderboard":
      return h(Leaderboard, {
        data,
        labelKey: resolvedX,
        valueKey: (resolvedY[0] as string) ?? "",
        height,
        unpriced,
      });
    case "table":
    default:
      return h(Table, { data, height });
  }
}
