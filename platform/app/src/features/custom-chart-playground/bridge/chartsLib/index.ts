/**
 * `@langwatch/charts` — the chart component library a playground widget
 * imports. Bundled by `scripts/build-charts-lib.mjs` into
 * `bridge/chartsLibSource.ts`'s `buildChartsLibScript()`, injected into the
 * sandboxed frame as `window.LWCharts` (see `buildSrcdoc.ts`), and resolved
 * by `bridge/authorRuntime.ts`'s require shim for the `"@langwatch/charts"`
 * specifier.
 *
 * Deliberately reads `window.React` / `window.Recharts` directly instead of
 * `import`-ing "react"/"recharts" as modules: the frame already loaded both
 * as CDN UMD globals (see `buildSrcdoc.ts`) before this script runs, and
 * every hook call here needs to land on that SAME React instance the
 * author's own component tree uses — a bundled second copy would violate
 * the rules of hooks the moment author code and this library render
 * together. No JSX either, for the same reason `authorRuntime.ts` needs no
 * jsx-transform config: `React.createElement` calls need nothing from
 * esbuild but `bundle: true`.
 *
 * All ten components consume `Row[]` — the `data` an `LW.useChartQuery`
 * result resolves to, i.e. `result.rows` — and default their color from
 * `window.LW.theme`, read lazily inside each render rather than at
 * script-load time (the shim sets `LW.theme` only after `lw:init`, which is
 * after this script has already executed once as an IIFE).
 */

type Row = Record<string, unknown>;

interface LWGlobal {
  theme?: "light" | "dark";
  navigate?: (target: string, params?: Record<string, unknown>) => void;
}

declare const window: {
  React: any;
  Recharts: any;
  LW?: LWGlobal;
};

// ---------------------------------------------------------------------------
// Theme + color helpers
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#a855f7",
  "#ec4899",
  "#84cc16",
];

const DEFAULT_HEIGHT = 240;

function currentTheme(): "light" | "dark" {
  return window.LW?.theme === "dark" ? "dark" : "light";
}

/** Chrome (axis/grid/text) colors — separate from the categorical data palette. */
function chrome() {
  const dark = currentTheme() === "dark";
  return {
    text: dark ? "#e5e7eb" : "#374151",
    axis: dark ? "#9ca3af" : "#6b7280",
    grid: dark ? "#374151" : "#e5e7eb",
    tooltipBg: dark ? "#1f2937" : "#ffffff",
    tooltipBorder: dark ? "#374151" : "#e5e7eb",
  };
}

function paletteFor(colors?: string[]): string[] {
  return colors && colors.length > 0 ? colors : DEFAULT_COLORS;
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
  return (value as number).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDuration(ms: number | null | undefined): string {
  if (isMissingNumber(ms)) return "–";
  if (!isFinite(ms as number)) return String(ms);
  if (Math.abs(ms as number) < 1000) return `${Math.round(ms as number)}ms`;
  if (Math.abs(ms as number) < 60000) return `${((ms as number) / 1000).toFixed(1)}s`;
  return `${((ms as number) / 60000).toFixed(1)}m`;
}

function formatValue(
  value: number | string | null | undefined,
  format?: MetricFormat,
): string {
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

/** A column reads as time-like by name, or by its first value parsing as a date. */
function isTimeLikeColumn(data: Row[], key: string): boolean {
  if (/date|time|timestamp|day|hour|week|month|bucket/i.test(key)) return true;
  const sample = data[0]?.[key];
  if (typeof sample === "string" && !isNaN(Date.parse(sample))) return true;
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
      .map((row) => Date.parse(String(row[key])))
      .filter((t) => !isNaN(t));
    if (times.length > 0) {
      spansMultipleDays = Math.max(...times) - Math.min(...times) > 24 * 60 * 60 * 1000;
    }
  }
  return (value: unknown): string => {
    const raw = String(value);
    if (!timeLike) return raw;
    const parsed = Date.parse(raw);
    if (isNaN(parsed)) return raw;
    const date = new Date(parsed);
    if (spansMultipleDays) {
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      return `${mm}-${dd}`;
    }
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
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
  return cols.filter(
    (col) => !exclude.includes(col) && data.some((row) => isNumeric(row[col])),
  );
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
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
// already run (guaranteed by buildSrcdoc.ts's script order).
// ---------------------------------------------------------------------------

function react() {
  return window.React;
}

function recharts() {
  return window.Recharts;
}

function h(type: any, props: any, ...children: any[]) {
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

function sparklinePoints(data: Row[] | number[], y?: string): { value: number }[] {
  if (data.length === 0) return [];
  if (typeof data[0] === "number") {
    return (data as number[]).map((value) => ({ value }));
  }
  const rows = data as Row[];
  const key = y ?? numericColumns(rows, [])[0];
  return rows.map((row) => ({ value: key ? toNumber(row[key]) : 0 }));
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
  const deltaColor = deltaDirection === "down" ? "#ef4444" : "#22c55e";
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
      h(
        "div",
        { style: { fontSize: 12, color: deltaColor } },
        `${deltaArrow} ${Math.abs(delta)}%`,
      ),
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
}

export function AreaTimeseries({
  data,
  x,
  series,
  stacked,
  projectionFrom,
  colors,
  height = DEFAULT_HEIGHT,
}: AreaTimeseriesProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const keys = Array.isArray(series) ? series : [series];
  const splitAt = projectionIndex(data, x, projectionFrom);

  // Two Area layers per series (actual, projected) sharing a stackId so a
  // stacked chart still composes correctly; only one of the pair is
  // non-null at any given x, so the "seam" at the split point is the only
  // row where both carry a value (continuity across the boundary).
  const rows = data.map((row, index) => {
    const out: Row = { ...row };
    keys.forEach((key) => {
      const isProjected = splitAt !== -1 && index >= splitAt;
      const isBoundary = splitAt !== -1 && index === splitAt - 1;
      out[`${key}__actual`] = !isProjected || isBoundary ? row[key] : null;
      out[`${key}__projected`] = isProjected || isBoundary ? row[key] : null;
    });
    return out;
  });

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
          R.AreaChart,
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
          h(R.Tooltip, {
            contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}` },
            labelStyle: { color: c.text },
          }),
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
function projectedBar(R: any, opts: {
  key: string;
  dataKey: string;
  color: string;
  stackId?: string;
  rowCount: number;
  splitAt: number;
}) {
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
            contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}` },
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
            contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}` },
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
        contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}` },
        labelStyle: { color: c.text },
      }),
      budget !== undefined &&
        h(R.ReferenceLine, {
          y: budget,
          stroke: "#ef4444",
          strokeDasharray: "4 3",
          label: { value: "Budget", position: "right", fill: "#ef4444", fontSize: 11 },
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
            ...data.map((_row, index) =>
              h(R.Cell, { key: index, fill: colorAt(palette, index) }),
            ),
          ),
          h(R.Tooltip, {
            contentStyle: { background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}` },
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

export interface LeaderboardProps {
  data: Row[];
  labelKey: string;
  valueKey: string;
  max?: number;
  format?: MetricFormat;
  height?: number;
  navigateTo?: { target: string; params: (row: Row) => object };
}

export function Leaderboard({
  data,
  labelKey,
  valueKey,
  max,
  format,
  height,
  navigateTo,
}: LeaderboardProps) {
  const c = chrome();
  const palette = paletteFor();
  const ranked = [...data].sort((a, b) => toNumber(b[valueKey]) - toNumber(a[valueKey]));
  const scaleMax = max ?? Math.max(1, ...ranked.map((row) => toNumber(row[valueKey])));

  return h(
    "div",
    { style: { height, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 } },
    ...ranked.map((row, index) => {
      const value = toNumber(row[valueKey]);
      const widthPct = Math.max(2, Math.min(100, (value / scaleMax) * 100));
      const clickable = typeof navigateTo?.params === "function";
      return h(
        "div",
        {
          key: index,
          onClick: clickable
            ? () => window.LW?.navigate?.(navigateTo!.target, navigateTo!.params(row) as Record<string, unknown>)
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
          { style: { fontSize: 12, color: c.text, minWidth: 96, flexShrink: 0 } },
          String(row[labelKey] ?? ""),
        ),
        h(
          "div",
          { style: { flex: 1, background: c.grid, borderRadius: 3, height: 10 } },
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
          { style: { fontSize: 12, color: c.axis, minWidth: 48, textAlign: "right" } },
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
  height?: number;
}

function interpolateColor(from: string, to: string, t: number): string {
  const parse = (hex: string) => {
    const n = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  };
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const mix = (a: number, b: number) => Math.round((a as number) + ((b as number) - (a as number)) * t);
  return `rgb(${mix(r1 as number, r2 as number)}, ${mix(g1 as number, g2 as number)}, ${mix(b1 as number, b2 as number)})`;
}

export function Heatmap({
  data,
  xKey,
  yKey,
  valueKey,
  xLabels,
  yLabels,
  colorScale,
  height = DEFAULT_HEIGHT,
}: HeatmapProps) {
  const cols = xLabels ?? (xKey === "hour" ? DEFAULT_HOUR_LABELS : undefined);
  const rows = yLabels ?? (yKey === "weekday" ? DEFAULT_WEEKDAY_LABELS : undefined);
  const xValues = cols ?? Array.from(new Set(data.map((row) => String(row[xKey]))));
  const yValues = rows ?? Array.from(new Set(data.map((row) => String(row[yKey]))));
  const scale = colorScale ?? ["#eef2ff", "#4338ca"];
  const values = data.map((row) => toNumber(row[valueKey]));
  const maxValue = Math.max(1, ...values);

  const lookup = new Map<string, number>();
  data.forEach((row) => {
    lookup.set(`${String(row[xKey])} ${String(row[yKey])}`, toNumber(row[valueKey]));
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
          const raw = lookup.get(`${xValue} ${yValue}`) ?? 0;
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
                String(row[col] ?? ""),
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
}

interface InferredShape {
  kind: LwqlChartKind;
  x: string;
  y: string[];
}

function inferShape(data: Row[], x?: string, y?: string | string[]): InferredShape {
  const cols = columnsOf(data);
  const explicitX = x ?? cols[0];
  const explicitY = y
    ? Array.isArray(y)
      ? y
      : [y]
    : numericColumns(data, explicitX ? [explicitX] : []);

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
 * Picks a concrete component from `data`'s shape (or the caller's explicit
 * `kind`/`x`/`y`/`series`) and renders it. See the file header and the
 * per-kind rules in the module docstring at the top of this file.
 */
export function LwqlChart({
  data,
  kind,
  x,
  y,
  series,
  colors,
  height = DEFAULT_HEIGHT,
}: LwqlChartProps) {
  const inferred = inferShape(data, x, y);
  const resolvedKind = kind ?? inferred.kind;
  const resolvedX = x ?? inferred.x;
  const resolvedY = y ? (Array.isArray(y) ? y : [y]) : inferred.y;

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
      });
    case "table":
    default:
      return h(Table, { data, height });
  }
}
