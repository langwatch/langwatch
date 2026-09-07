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
// Design tokens + theme + color helpers
// ---------------------------------------------------------------------------

/**
 * The categorical ramp — the prototype's `--chart-1..8` order. Shared by
 * `DEFAULT_COLORS` (the palette every component defaults to) and `TOKENS.ramp`
 * so a chart and a hand-rolled tile pick the same color for the same index.
 */
const RAMP = [
  "#4299e1",
  "#ed8926",
  "#9f7aea",
  "#48bb78",
  "#ed64a6",
  "#38b2ac",
  "#0bc5ea",
  "#ecc94b",
];

const DEFAULT_COLORS = RAMP;

const DEFAULT_HEIGHT = 240;

const FONT_STACK =
  '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const MONO_STACK =
  '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

interface ThemeTokens {
  ramp: string[];
  ok: string;
  warn: string;
  danger: string;
  accent: string;
  faint: string;
  muted: string;
  fg: string;
  border: string;
  surface: string;
  chrome: string;
  font: string;
  mono: string;
}

const LIGHT_TOKENS: ThemeTokens = {
  ramp: RAMP,
  ok: "#38a169",
  warn: "#ed8926",
  danger: "#e53e3e",
  accent: "#ed8926",
  faint: "#9ca3af",
  muted: "#5c5c6e",
  fg: "#1a1a2e",
  border: "#e2e8f0",
  surface: "#ffffff",
  chrome: "#f1f5f9",
  font: FONT_STACK,
  mono: MONO_STACK,
};

// Dark counterparts: the tones (ok/warn/danger/accent) read fine on a dark
// ground so they carry over; only the neutral surface/foreground roles swap.
const DARK_TOKENS: ThemeTokens = {
  ramp: RAMP,
  ok: "#48bb78",
  warn: "#ed8926",
  danger: "#f56565",
  accent: "#ed8926",
  faint: "#6b7280",
  muted: "#9ca3af",
  fg: "#e6e6f0",
  border: "#2d2d40",
  surface: "#1a1a2e",
  chrome: "#12121c",
  font: FONT_STACK,
  mono: MONO_STACK,
};

function currentTheme(): "light" | "dark" {
  return typeof window !== "undefined" && window.LW?.theme === "dark"
    ? "dark"
    : "light";
}

/** The resolved token set for the current theme, read lazily inside a render. */
function tokens(): ThemeTokens {
  return currentTheme() === "dark" ? DARK_TOKENS : LIGHT_TOKENS;
}

/**
 * Design tokens as a live, theme-aware object. Every property is a getter so
 * `TOKENS.danger` reflects the theme at read time (the frame sets
 * `LW.theme` only after `lw:init`, after this module's IIFE has already run).
 */
export const TOKENS: ThemeTokens = {
  get ramp() {
    return tokens().ramp;
  },
  get ok() {
    return tokens().ok;
  },
  get warn() {
    return tokens().warn;
  },
  get danger() {
    return tokens().danger;
  },
  get accent() {
    return tokens().accent;
  },
  get faint() {
    return tokens().faint;
  },
  get muted() {
    return tokens().muted;
  },
  get fg() {
    return tokens().fg;
  },
  get border() {
    return tokens().border;
  },
  get surface() {
    return tokens().surface;
  },
  get chrome() {
    return tokens().chrome;
  },
  get font() {
    return tokens().font;
  },
  get mono() {
    return tokens().mono;
  },
};

/**
 * The prototype's FIXED_COLORS map — headline entities keep the same ramp
 * color on every chart and in every space. Names not in the map fall back to a
 * stable hash of the name so an unknown series still gets a consistent color.
 */
const FIXED_COLORS: Record<string, number> = {
  "gpt-5": 0,
  "claude-sonnet-4.5": 1,
  "llama-4-70b": 2,
  "gemini-2.5-pro": 3,
  "claude-opus-4.5": 4,
  "gpt-5-mini": 5,
  "GitHub Copilot": 0,
  "Claude Code": 1,
  Cursor: 2,
  "Databricks Genie": 3,
  "Copilot Studio": 4,
  "ChatGPT Enterprise": 5,
  "Custom Agents": 6,
  Engineering: 0,
  "Data & AI": 2,
  "Customer Support": 3,
  Marketing: 4,
};

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** The stable ramp color for a named entity — fixed if known, else hashed. */
export function fixedColor(name: string): string {
  const ramp = tokens().ramp;
  const index = FIXED_COLORS[name] ?? stableHash(String(name));
  return ramp[index % ramp.length] as string;
}

/** Chrome (axis/grid/text) colors, derived from the theme tokens. */
function chrome() {
  const t = tokens();
  return {
    text: t.fg,
    axis: t.muted,
    grid: t.border,
    tooltipBg: t.surface,
    tooltipBorder: t.border,
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

/**
 * The value-format vocabulary a chart or tile declares. `currency` keeps its
 * original full-precision `$1,410` shape for backward compatibility; the
 * prototype-matching money format is `cost` (`$0.00`/`$123`/`$12.3k`/`$1.2M`).
 */
export type MetricFormat =
  | "number"
  | "currency"
  | "cost"
  | "percent"
  | "duration"
  | "duration_min"
  | "tokens"
  | "tokens_k";

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** True when a value is missing or not a usable number (null/undefined/NaN). */
function isMissingNumber(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && isNaN(value))
  );
}

function formatNumber(value: number | null | undefined): string {
  if (isMissingNumber(value)) return "–";
  return (value as number).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

/**
 * Compact for large magnitudes (`12.3k`/`1.2M`/`1.2B`) but full-precision
 * under 10k, so a sub-1 fraction still reads as `0.14` rather than rounding to
 * `0`. Backs the prototype `number`/`tokens` formats.
 */
function compactOrPrecise(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${nf1.format(n / 1e9)}B`;
  if (abs >= 1e6) return `${nf1.format(n / 1e6)}M`;
  if (abs >= 1e4) return `${nf1.format(n / 1e3)}k`;
  return formatNumber(n);
}

/** The prototype `fmtCost`: `$0.00`<100, `$123`<10k, `$12.3k`<1M, `$1.2M`. */
function formatCost(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${nf1.format(n / 1e6)}M`;
  if (abs >= 1e4) return `$${nf1.format(n / 1e3)}k`;
  if (abs >= 100) return `$${nf0.format(n)}`;
  return `$${nf2.format(n)}`;
}

/** The prototype `fmtMin`: `38 min` under an hour, else `2h 10m`. */
function formatDurationMin(min: number): string {
  if (Math.abs(min) < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

function formatDuration(ms: number | null | undefined): string {
  if (isMissingNumber(ms)) return "–";
  if (!isFinite(ms as number)) return String(ms);
  if (Math.abs(ms as number) < 1000) return `${Math.round(ms as number)}ms`;
  if (Math.abs(ms as number) < 60000)
    return `${((ms as number) / 1000).toFixed(1)}s`;
  return `${((ms as number) / 60000).toFixed(1)}m`;
}

export function formatValue(
  value: number | string | null | undefined,
  format?: MetricFormat,
): string {
  if (typeof value === "string") return value;
  if (isMissingNumber(value)) return "–";
  const num = value as number;
  switch (format) {
    case "currency":
      return `$${formatNumber(num)}`;
    case "cost":
      return formatCost(num);
    case "percent":
      return `${(num * 100).toFixed(1)}%`;
    case "duration":
      return formatDuration(num);
    case "duration_min":
      return formatDurationMin(num);
    case "tokens_k":
      return compactOrPrecise(num * 1000);
    case "tokens":
    case "number":
    default:
      return compactOrPrecise(num);
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
function axisTickFormatter(
  key: string,
  data: Row[],
): (value: unknown) => string {
  const timeLike = isTimeLikeColumn(data, key);
  let spansMultipleDays = false;
  if (timeLike) {
    const times = data
      .map((row) => Date.parse(String(row[key])))
      .filter((t) => !isNaN(t));
    if (times.length > 0) {
      spansMultipleDays =
        Math.max(...times) - Math.min(...times) > 24 * 60 * 60 * 1000;
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

/**
 * A YAxis tick, honoring the same `format` a tooltip or `MetricStat` gets —
 * compact like `compactNumber` (an axis has no room for `formatValue`'s
 * full-precision `toLocaleString`), but with the right unit: `$` prefixed,
 * `%` suffixed and multiplied for a 0-1 fraction, or duration-shortened.
 * Without this, a chart declaring `format="percent"` or `"currency"` drew a
 * bare axis number with no unit at all.
 */
export function formatAxisValue(value: unknown, format?: MetricFormat): string {
  if (isMissingNumber(value)) return "";
  const num = value as number;
  switch (format) {
    case "currency":
    case "cost":
      return `$${compactNumber(num)}`;
    case "percent":
      return `${compactNumber(num * 100)}%`;
    case "duration":
      return formatDuration(num);
    case "duration_min":
      return formatDurationMin(num);
    case "tokens_k":
      return compactNumber(num * 1000);
    case "tokens":
    case "number":
    default:
      return compactNumber(num);
  }
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
function legendBar(
  keys: string[],
  palette: string[],
  c: ReturnType<typeof chrome>,
) {
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
// Reference lines / areas — shared by every Recharts-based component
// ---------------------------------------------------------------------------

export interface ReferenceLine {
  y?: number;
  x?: number | string;
  label?: string;
  color?: string;
  dashed?: boolean;
  position?: "insideTopRight" | "insideTopLeft" | "insideBottomRight";
}

export interface ReferenceArea {
  y1?: number;
  y2?: number;
  x1?: number | string;
  x2?: number | string;
  label?: string;
  color?: string;
  opacity?: number;
}

/** Recharts `<ReferenceLine>` nodes for a `referenceLines` prop (dashed by default). */
function referenceLineNodes(R: any, lines?: ReferenceLine[]): any[] {
  const t = tokens();
  return (lines ?? []).map((line, index) => {
    const color = line.color ?? t.faint;
    return h(R.ReferenceLine, {
      key: `refl-${index}`,
      ...(line.y !== undefined ? { y: line.y } : {}),
      ...(line.x !== undefined ? { x: line.x } : {}),
      stroke: color,
      strokeDasharray: line.dashed === false ? undefined : "4 3",
      ifOverflow: "extendDomain",
      label: line.label
        ? {
            value: line.label,
            position: line.position ?? "insideTopRight",
            fill: color,
            fontSize: 10.5,
          }
        : undefined,
    });
  });
}

/** Recharts `<ReferenceArea>` nodes for a `referenceAreas` prop (shaded band). */
function referenceAreaNodes(R: any, areas?: ReferenceArea[]): any[] {
  const t = tokens();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent conditional branches with no shared state.
  return (areas ?? []).map((area, index) =>
    h(R.ReferenceArea, {
      key: `refa-${index}`,
      ...(area.y1 !== undefined ? { y1: area.y1 } : {}),
      ...(area.y2 !== undefined ? { y2: area.y2 } : {}),
      ...(area.x1 !== undefined ? { x1: area.x1 } : {}),
      ...(area.x2 !== undefined ? { x2: area.x2 } : {}),
      fill: area.color ?? t.ramp[0],
      fillOpacity: area.opacity ?? 0.1,
      stroke: "none",
      ifOverflow: "extendDomain",
      label: area.label
        ? {
            value: area.label,
            position: "insideTopRight",
            fill: t.muted,
            fontSize: 10.5,
          }
        : undefined,
    }),
  );
}

/** Shared "no rows" placeholder honoring the given height and theme. */
function emptyState(text: string, height?: number) {
  const c = chrome();
  return h(
    "div",
    {
      style: {
        height: height ?? DEFAULT_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: c.axis,
        fontSize: 12,
        fontFamily: tokens().font,
        textAlign: "center",
        padding: "0 12px",
      },
    },
    text,
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

function sparklinePoints(
  data: Row[] | number[],
  y?: string,
): { value: number }[] {
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
  format?: MetricFormat;
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceArea[];
  /** Force the legend on/off; defaults to on when more than one series. */
  legend?: boolean;
  /** Accepted for a uniform bar/area prop surface; per-cell coloring only affects bar charts. */
  colorBy?: (row: Row) => string;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one component computing series geometry and rendering the SVG chart together.
export function AreaTimeseries({
  data,
  x,
  series,
  stacked,
  projectionFrom,
  colors,
  height = DEFAULT_HEIGHT,
  format,
  referenceLines,
  referenceAreas,
  legend,
}: AreaTimeseriesProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const keys = Array.isArray(series) ? series : [series];
  const splitAt = projectionIndex(data, x, projectionFrom);
  if (data.length === 0) return emptyState("No data", height);
  const showLegend = legend ?? keys.length > 1;

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
    showLegend && legendBar(keys, palette, c),
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
          ...referenceAreaNodes(R, referenceAreas),
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
            tickFormatter: (value: unknown) => formatAxisValue(value, format),
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
            formatter: (value: unknown) => formatValue(value as number, format),
          }),
          ...areas,
          ...referenceLineNodes(R, referenceLines),
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
  R: any,
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
  format?: MetricFormat;
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceArea[];
  legend?: boolean;
  /** Per-bar color; only applied when a single series is drawn. */
  colorBy?: (row: Row) => string;
}

export function StackedBars({
  data,
  x,
  series,
  projectionFrom,
  colors,
  height = DEFAULT_HEIGHT,
  format,
  referenceLines,
  referenceAreas,
  legend,
  colorBy,
}: StackedBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const splitAt = projectionIndex(data, x, projectionFrom);
  if (data.length === 0) return emptyState("No data", height);
  const showLegend = legend ?? series.length > 1;

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend && legendBar(series, palette, c),
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
          ...referenceAreaNodes(R, referenceAreas),
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
            tickFormatter: (value: unknown) => formatAxisValue(value, format),
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
            formatter: (value: unknown) => formatValue(value as number, format),
          }),
          ...series.map((key, index) =>
            colorBy && series.length === 1
              ? h(
                  R.Bar,
                  { key, dataKey: key, isAnimationActive: false },
                  ...data.map((row, rowIndex) =>
                    h(R.Cell, { key: rowIndex, fill: colorBy(row) }),
                  ),
                )
              : projectedBar(R, {
                  key,
                  dataKey: key,
                  color: colorAt(palette, index),
                  stackId: "stack",
                  rowCount: data.length,
                  splitAt,
                }),
          ),
          ...referenceLineNodes(R, referenceLines),
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
  format?: MetricFormat;
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceArea[];
  legend?: boolean;
  /** Per-bar color; only applied when a single series is drawn. */
  colorBy?: (row: Row) => string;
}

export function GroupedBars({
  data,
  x,
  series,
  colors,
  height = DEFAULT_HEIGHT,
  format,
  referenceLines,
  referenceAreas,
  legend,
  colorBy,
}: GroupedBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  if (data.length === 0) return emptyState("No data", height);
  const showLegend = legend ?? series.length > 1;

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend && legendBar(series, palette, c),
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
          ...referenceAreaNodes(R, referenceAreas),
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
            tickFormatter: (value: unknown) => formatAxisValue(value, format),
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
            formatter: (value: unknown) => formatValue(value as number, format),
          }),
          ...series.map((key, index) =>
            colorBy && series.length === 1
              ? h(
                  R.Bar,
                  { key, dataKey: key, isAnimationActive: false },
                  ...data.map((row, rowIndex) =>
                    h(R.Cell, { key: rowIndex, fill: colorBy(row) }),
                  ),
                )
              : h(R.Bar, {
                  key,
                  dataKey: key,
                  fill: colorAt(palette, index),
                  isAnimationActive: false,
                }),
          ),
          ...referenceLineNodes(R, referenceLines),
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
  format?: MetricFormat;
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceArea[];
  colorBy?: (row: Row) => string;
  legend?: boolean;
}

export function ProjectionBars({
  data,
  x,
  y,
  projectionFrom,
  budget,
  colors,
  height = DEFAULT_HEIGHT,
  format,
  referenceLines,
  referenceAreas,
  colorBy,
}: ProjectionBarsProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  const splitAt = projectionIndex(data, x, projectionFrom);
  if (data.length === 0) return emptyState("No data", height);

  return h(
    R.ResponsiveContainer,
    { width: "100%", height },
    h(
      R.BarChart,
      { data, margin: { top: 6, right: 8, bottom: 0, left: 0 } },
      h(R.CartesianGrid, { stroke: c.grid, vertical: false }),
      ...referenceAreaNodes(R, referenceAreas),
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
        tickFormatter: (value: unknown) => formatAxisValue(value, format),
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
        formatter: (value: unknown) => formatValue(value as number, format),
      }),
      budget !== undefined &&
        h(R.ReferenceLine, {
          y: budget,
          stroke: tokens().danger,
          strokeDasharray: "4 3",
          label: {
            value: "Budget",
            position: "right",
            fill: tokens().danger,
            fontSize: 11,
          },
        }),
      colorBy
        ? h(
            R.Bar,
            { dataKey: y, isAnimationActive: false },
            ...data.map((row, rowIndex) =>
              h(R.Cell, { key: rowIndex, fill: colorBy(row) }),
            ),
          )
        : projectedBar(R, {
            key: y,
            dataKey: y,
            color: palette[0] as string,
            rowCount: data.length,
            splitAt,
          }),
      ...referenceLineNodes(R, referenceLines),
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
  /** When true, the legend lists each slice's value and percent, not just a swatch. */
  legend?: boolean;
  format?: MetricFormat;
}

/** A donut legend row per slice: swatch, name, value and percent-of-total. */
function donutLegend(opts: {
  data: Row[];
  nameKey: string;
  valueKey: string;
  palette: string[];
  format?: MetricFormat;
  c: ReturnType<typeof chrome>;
}) {
  const { data, nameKey, valueKey, palette, format, c } = opts;
  const total = data.reduce((sum, row) => sum + toNumber(row[valueKey]), 0);
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
        fontFamily: tokens().font,
      },
    },
    ...data.map((row, index) => {
      const value = toNumber(row[valueKey]);
      const pct = total > 0 ? (value / total) * 100 : 0;
      return h(
        "div",
        {
          key: index,
          style: { display: "flex", alignItems: "center", gap: 4 },
        },
        h("span", {
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colorAt(palette, index),
            flexShrink: 0,
          },
        }),
        `${String(row[nameKey])} ${formatValue(value, format)} (${pct.toFixed(1)}%)`,
      );
    }),
  );
}

export function Donut({
  data,
  nameKey,
  valueKey,
  centerLabel,
  colors,
  height = DEFAULT_HEIGHT,
  legend,
  format,
}: DonutProps) {
  const R = recharts();
  const c = chrome();
  const palette = paletteFor(colors);
  if (data.length === 0) return emptyState("No data", height);

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    legend
      ? donutLegend({ data, nameKey, valueKey, palette, format, c })
      : data.length > 1 &&
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
  const ranked = [...data].sort(
    (a, b) => toNumber(b[valueKey]) - toNumber(a[valueKey]),
  );
  const scaleMax =
    max ?? Math.max(1, ...ranked.map((row) => toNumber(row[valueKey])));

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
      const widthPct = Math.max(2, Math.min(100, (value / scaleMax) * 100));
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
          String(row[labelKey] ?? ""),
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

const DEFAULT_HOUR_LABELS = Array.from({ length: 24 }, (_unused, i) =>
  String(i),
);
const DEFAULT_WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

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

/** The default heatmap scale, also the fallback for an unparsable colorScale. */
const HEATMAP_FALLBACK_SCALE: [string, string] = ["#eef2ff", "#4338ca"];

/**
 * Parses `#rgb` or `#rrggbb` to an [r, g, b] triple, or null for anything
 * else. Author `colorScale` is compiled by Babel with no type checking, so a
 * 3-digit shorthand (`#abc`) reaches here as ordinary CSS — expand it rather
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
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function interpolateColor(from: string, to: string, t: number): string {
  const [r1, g1, b1] =
    parseHexRgb(from) ?? parseHexRgb(HEATMAP_FALLBACK_SCALE[0])!;
  const [r2, g2, b2] =
    parseHexRgb(to) ?? parseHexRgb(HEATMAP_FALLBACK_SCALE[1])!;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

/** A label cell shared by the corner gutter, the column header and the row gutter. */
function heatmapLabelCell(opts: {
  key: string;
  label: string;
  align: "center" | "right";
  color: string;
}) {
  const { key, label, align, color } = opts;
  return h(
    "div",
    {
      key,
      style: {
        fontSize: 10.5,
        color,
        textAlign: align,
        padding: align === "right" ? "0 6px 0 0" : 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      },
    },
    label,
  );
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
  const c = chrome();
  const cols = xLabels ?? (xKey === "hour" ? DEFAULT_HOUR_LABELS : undefined);
  const rows =
    yLabels ?? (yKey === "weekday" ? DEFAULT_WEEKDAY_LABELS : undefined);
  const xValues =
    cols ?? Array.from(new Set(data.map((row) => String(row[xKey]))));
  const yValues =
    rows ?? Array.from(new Set(data.map((row) => String(row[yKey]))));
  const scale = colorScale ?? ["#eef2ff", "#4338ca"];
  const values = data.map((row) => toNumber(row[valueKey]));
  const maxValue = Math.max(1, ...values);

  const lookup = new Map<string, number>();
  data.forEach((row) => {
    lookup.set(
      `${String(row[xKey])}\u0000${String(row[yKey])}`,
      toNumber(row[valueKey]),
    );
  });

  // A leading gutter column for the row labels, on top of the one column per
  // x value the data grid already had — the corner cell above the gutter
  // stays blank rather than growing a third row template.
  const gridTemplateColumns = `minmax(28px, auto) repeat(${xValues.length}, minmax(16px, 1fr))`;

  return h(
    "div",
    { style: { height, overflow: "auto" } },
    h(
      "div",
      { style: { display: "grid", gridTemplateColumns, gap: 2 } },
      heatmapLabelCell({
        key: "corner",
        label: "",
        align: "center",
        color: c.axis,
      }),
      ...xValues.map((xValue, xIndex) =>
        heatmapLabelCell({
          key: `col-${xIndex}`,
          label: xValue,
          align: "center",
          color: c.axis,
        }),
      ),
      ...yValues.flatMap((yValue, yIndex) => [
        heatmapLabelCell({
          key: `row-${yIndex}`,
          label: yValue,
          align: "right",
          color: c.axis,
        }),
        ...xValues.map((xValue, xIndex) => {
          const raw = lookup.get(`${xValue}\u0000${yValue}`) ?? 0;
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
      ]),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tone + small shared helpers for the presentation primitives
// ---------------------------------------------------------------------------

export type Tone = "ok" | "warn" | "danger" | "neutral";

/** A tone name → its token color. Unknown/neutral falls back to muted. */
function toneColor(tone?: string): string {
  const t = tokens();
  switch (tone) {
    case "ok":
      return t.ok;
    case "warn":
      return t.warn;
    case "danger":
      return t.danger;
    case "accent":
      return t.accent;
    default:
      return t.muted;
  }
}

/** Append a 2-hex alpha to a #rrggbb color; pass others through unchanged. */
function withAlpha(hex: string, alphaHex: string): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alphaHex}` : hex;
}

interface BadgeSpec {
  text: string;
  tone?: Tone;
}

// ---------------------------------------------------------------------------
// Badge — a small pill chip
// ---------------------------------------------------------------------------

export interface BadgeProps {
  text: string;
  tone?: Tone;
  outline?: boolean;
}

export function Badge({ text, tone = "neutral", outline }: BadgeProps) {
  const color = toneColor(tone);
  return h(
    "span",
    {
      style: {
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.2,
        lineHeight: 1.4,
        padding: "1px 6px",
        borderRadius: 999,
        fontFamily: tokens().font,
        color,
        background: outline ? "transparent" : withAlpha(color, "1a"),
        border: outline ? `1px solid ${color}` : "none",
        whiteSpace: "nowrap",
      },
    },
    text,
  );
}

// ---------------------------------------------------------------------------
// StatTiles — 2–4 equal columns, big number + muted label
// ---------------------------------------------------------------------------

export interface StatTile {
  value: number | string;
  format?: MetricFormat;
  label: string;
  sub?: string;
  badge?: BadgeSpec;
  tone?: Tone;
}

export interface StatTilesProps {
  tiles: StatTile[];
  divided?: boolean;
}

export function StatTiles({ tiles, divided }: StatTilesProps) {
  if (!tiles || tiles.length === 0) return emptyState("No data");
  const c = chrome();
  const t = tokens();
  return h(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: `repeat(${tiles.length}, 1fr)`,
        fontFamily: t.font,
      },
    },
    ...tiles.map((tile, index) =>
      h(
        "div",
        {
          key: index,
          style: {
            padding: "4px 12px",
            borderLeft:
              divided && index > 0 ? `1px solid ${t.border}` : undefined,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              flexWrap: "wrap",
            },
          },
          h(
            "div",
            {
              style: {
                fontSize: 22,
                fontWeight: 600,
                lineHeight: 1.15,
                color: tile.tone ? toneColor(tile.tone) : t.fg,
              },
            },
            formatValue(tile.value, tile.format),
          ),
          tile.badge &&
            h(Badge, { text: tile.badge.text, tone: tile.badge.tone }),
        ),
        h("div", { style: { fontSize: 11, color: c.axis } }, tile.label),
        tile.sub &&
          h("div", { style: { fontSize: 10.5, color: t.faint } }, tile.sub),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// RankedList — icon / title / sub, right-aligned value + badge, clickable
// ---------------------------------------------------------------------------

export interface RankedListRow {
  title: string;
  sub?: string;
  value?: number | string;
  format?: MetricFormat;
  badge?: BadgeSpec;
  icon?: string;
  onClick?: () => void;
  tone?: Tone;
}

export interface RankedListProps {
  rows: RankedListRow[];
  max?: number;
  emptyText?: string;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function RankedList({
  rows,
  max,
  emptyText = "No data",
}: RankedListProps) {
  const t = tokens();
  const shown = max ? rows.slice(0, max) : rows;
  if (shown.length === 0) return emptyState(emptyText);
  const ellipsis = {
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  };
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontFamily: t.font,
        overflowY: "auto",
      },
    },
    ...shown.map((row, index) =>
      h(
        "div",
        {
          key: index,
          onClick: row.onClick,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: row.onClick ? "pointer" : "default",
          },
        },
        row.icon &&
          h("span", { style: { fontSize: 13, flexShrink: 0 } }, row.icon),
        h(
          "div",
          { style: { flex: 1, minWidth: 0 } },
          h(
            "div",
            {
              style: {
                fontSize: 12,
                color: t.fg,
                display: "flex",
                alignItems: "center",
                gap: 6,
                ...ellipsis,
              },
            },
            h("span", { style: ellipsis }, row.title),
            row.badge &&
              h(Badge, { text: row.badge.text, tone: row.badge.tone }),
          ),
          row.sub &&
            h(
              "div",
              { style: { fontSize: 10.5, color: t.faint, ...ellipsis } },
              row.sub,
            ),
        ),
        row.value !== undefined &&
          h(
            "div",
            {
              style: {
                fontSize: 12,
                fontWeight: 600,
                color: row.tone ? toneColor(row.tone) : t.fg,
                flexShrink: 0,
                textAlign: "right",
              },
            },
            formatValue(row.value, row.format),
          ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// BarList — label/sub left, value right, thin proportional bar under
// ---------------------------------------------------------------------------

export interface BarListRow {
  label: string;
  sub?: string;
  value: number;
  meta?: string;
  color?: string;
  tone?: Tone;
}

export interface BarListProps {
  rows: BarListRow[];
  format?: MetricFormat;
  max?: number;
  sort?: "desc" | "asc" | "none";
  showValue?: boolean;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function BarList({
  rows,
  format,
  max,
  sort = "desc",
  showValue = true,
}: BarListProps) {
  const t = tokens();
  const c = chrome();
  let list = [...rows];
  if (sort === "desc") list.sort((a, b) => b.value - a.value);
  else if (sort === "asc") list.sort((a, b) => a.value - b.value);
  if (max) list = list.slice(0, max);
  if (list.length === 0) return emptyState("No data");
  const scaleMax = Math.max(1, ...list.map((row) => Math.abs(row.value)));
  const ellipsis = {
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
  };
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        fontFamily: t.font,
        overflowY: "auto",
      },
    },
    ...list.map((row, index) => {
      const widthPct = Math.max(
        2,
        Math.min(100, (Math.abs(row.value) / scaleMax) * 100),
      );
      const color = row.color ?? (row.tone ? toneColor(row.tone) : t.accent);
      return h(
        "div",
        {
          key: index,
          style: { display: "flex", flexDirection: "column", gap: 3 },
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "baseline", gap: 8 } },
          h(
            "div",
            { style: { flex: 1, minWidth: 0 } },
            h(
              "div",
              { style: { fontSize: 12, color: t.fg, ...ellipsis } },
              row.label,
            ),
            row.sub &&
              h("div", { style: { fontSize: 10.5, color: t.faint } }, row.sub),
          ),
          row.meta &&
            h(
              "div",
              { style: { fontSize: 10.5, color: t.faint, flexShrink: 0 } },
              row.meta,
            ),
          showValue &&
            h(
              "div",
              {
                style: {
                  fontSize: 12,
                  fontWeight: 600,
                  color: t.fg,
                  flexShrink: 0,
                },
              },
              formatValue(row.value, format),
            ),
        ),
        h(
          "div",
          {
            style: {
              height: 6,
              borderRadius: 3,
              background: c.grid,
              overflow: "hidden",
            },
          },
          h("div", {
            style: {
              width: `${widthPct}%`,
              height: "100%",
              borderRadius: 3,
              background: color,
            },
          }),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// Gauge — SVG speedometer arc with a needle
// ---------------------------------------------------------------------------

export interface GaugeZone {
  to: number;
  color: string;
}

export interface GaugeProps {
  value: number;
  zones?: Array<{ to: number; color: string }>;
  label: string;
  sub?: string;
  badge?: BadgeSpec;
  size?: number;
}

/** A point on a circle, with y measured downward (SVG) but angles measured up. */
// biome-ignore lint/complexity/useMaxParams: geometry helper reads clearer with positional cx, cy, r, angle.
function gaugePolar(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

/** A polyline `d` string along the arc from `fromDeg` to `toDeg`. */
// biome-ignore lint/complexity/useMaxParams: geometry helper reads clearer with positional cx, cy, r, angle.
function gaugeArc(
  cx: number,
  cy: number,
  r: number,
  fromDeg: number,
  toDeg: number,
): string {
  const steps = 24;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const [x, y] = gaugePolar(cx, cy, r, deg);
    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function Gauge({
  value,
  zones,
  label,
  sub,
  badge,
  size = 200,
}: GaugeProps) {
  const t = tokens();
  const c = chrome();
  const clamped = Math.max(0, Math.min(1, isMissingNumber(value) ? 0 : value));
  const stroke = Math.max(8, size * 0.06);
  const pad = stroke / 2 + 2;
  const r = size / 2 - pad;
  const cx = size / 2;
  const cy = size / 2;
  const height = cy + pad + 4;
  const zoneList =
    zones && zones.length > 0
      ? zones
      : [
          { to: 0.6, color: t.danger },
          { to: 0.9, color: t.warn },
          { to: 1, color: t.ok },
        ];
  // Angle runs 180° (left, value 0) → 0° (right, value 1) over the top.
  const angleFor = (f: number) => 180 - Math.max(0, Math.min(1, f)) * 180;
  let prev = 0;
  const arcs = zoneList.map((zone, index) => {
    const seg = h("path", {
      key: index,
      d: gaugeArc(cx, cy, r, angleFor(prev), angleFor(zone.to)),
      stroke: zone.color,
      strokeWidth: stroke,
      strokeLinecap: "round",
      fill: "none",
      opacity: 0.8,
    });
    prev = zone.to;
    return seg;
  });
  const [nx, ny] = gaugePolar(cx, cy, r * 0.82, angleFor(clamped));
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: t.font,
      },
    },
    h(
      "svg",
      { width: size, height, viewBox: `0 0 ${size} ${height}` },
      h("path", {
        d: gaugeArc(cx, cy, r, 180, 0),
        stroke: c.grid,
        strokeWidth: stroke,
        strokeLinecap: "round",
        fill: "none",
      }),
      ...arcs,
      h("line", {
        x1: cx,
        y1: cy,
        x2: nx,
        y2: ny,
        stroke: t.fg,
        strokeWidth: 2.5,
        strokeLinecap: "round",
      }),
      h("circle", { cx, cy, r: 4, fill: t.fg }),
    ),
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          marginTop: -4,
        },
      },
      h(
        "div",
        { style: { fontSize: 22, fontWeight: 600, color: t.fg } },
        formatValue(clamped, "percent"),
      ),
      badge && h(Badge, { text: badge.text, tone: badge.tone }),
    ),
    h("div", { style: { fontSize: 11, color: c.axis } }, label),
    sub && h("div", { style: { fontSize: 10.5, color: t.faint } }, sub),
  );
}

// ---------------------------------------------------------------------------
// CalendarHeatmap — GitHub-contribution style
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface CalendarHeatmapProps {
  data: Array<{ date: string; value: number }>;
  days?: number;
  color?: string;
  endDate?: string;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function CalendarHeatmap({
  data,
  days = 91,
  color,
  endDate,
}: CalendarHeatmapProps) {
  const t = tokens();
  const c = chrome();
  const values = new Map<string, number>();
  data.forEach((row) =>
    values.set(String(row.date).slice(0, 10), toNumber(row.value)),
  );
  const maxValue = Math.max(1, ...data.map((row) => toNumber(row.value)));
  const fill = color ?? t.ramp[3] ?? t.accent;

  const end = endDate
    ? new Date(`${endDate}T00:00:00`)
    : data.length > 0
      ? new Date(`${[...values.keys()].sort().slice(-1)[0]}T00:00:00`)
      : new Date();
  if (isNaN(end.getTime())) return emptyState("No data");
  // Start `days` back, then align to the Sunday on/before it so weeks are columns.
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setDate(start.getDate() - start.getDay());

  const cells: Array<{
    key: string;
    value: number | null;
    monthStart: boolean;
  }> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor);
    const has = values.has(key);
    cells.push({
      key,
      value: has ? (values.get(key) as number) : null,
      monthStart: cursor.getDate() <= 7,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const weekCount = Math.ceil(cells.length / 7);

  const cell = (index: number) => {
    const item = cells[index];
    if (!item) return h("div", { style: { width: 11, height: 11 } });
    const intensity = item.value === null ? 0 : item.value / maxValue;
    const bg =
      item.value === null || item.value === 0
        ? c.grid
        : withAlpha(
            fill,
            Math.round(40 + intensity * 215)
              .toString(16)
              .padStart(2, "0"),
          );
    return h("div", {
      key: item.key,
      title: `${item.key}: ${item.value ?? 0}`,
      style: { width: 11, height: 11, borderRadius: 2, background: bg },
    });
  };

  // Month labels aligned to the week column where each month starts.
  const monthRow = h(
    "div",
    { style: { display: "flex", gap: 3, marginLeft: 22, marginBottom: 2 } },
    ...Array.from({ length: weekCount }, (_unused, week) => {
      const first = cells[week * 7];
      const label = first?.monthStart
        ? MONTH_LABELS[new Date(`${first.key}T00:00:00`).getMonth()]
        : "";
      return h(
        "div",
        {
          key: week,
          style: {
            width: 11,
            fontSize: 9,
            color: c.axis,
            whiteSpace: "nowrap",
          },
        },
        label,
      );
    }),
  );

  const weekdayGutter = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 3,
        marginRight: 4,
        fontSize: 9,
        color: c.axis,
      },
    },
    ...["", "Mon", "", "Wed", "", "Fri", ""].map((label, index) =>
      h(
        "div",
        { key: index, style: { height: 11, lineHeight: "11px" } },
        label,
      ),
    ),
  );

  return h(
    "div",
    { style: { fontFamily: t.font, overflowX: "auto" } },
    monthRow,
    h(
      "div",
      { style: { display: "flex" } },
      weekdayGutter,
      h(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateRows: "repeat(7, 11px)",
            gridAutoFlow: "column",
            gap: 3,
          },
        },
        ...cells.map((_item, index) => cell(index)),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Histogram — vertical bars, optional stat tiles
// ---------------------------------------------------------------------------

export interface HistogramProps {
  buckets: Array<{ label: string; value: number }>;
  stats?: Array<{
    label: string;
    value: string | number;
    format?: MetricFormat;
  }>;
  color?: string;
  valueFormat?: MetricFormat;
  height?: number;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function Histogram({
  buckets,
  stats,
  color,
  valueFormat,
  height = DEFAULT_HEIGHT,
}: HistogramProps) {
  const t = tokens();
  const c = chrome();
  if (!buckets || buckets.length === 0) return emptyState("No data", height);
  const fill = color ?? t.accent;
  const maxValue = Math.max(
    1,
    ...buckets.map((bucket) => Math.abs(bucket.value)),
  );
  const statRow =
    stats && stats.length > 0
      ? h(
          "div",
          { style: { display: "flex", gap: 16, marginBottom: 8 } },
          ...stats.map((stat, index) =>
            h(
              "div",
              {
                key: index,
                style: { display: "flex", flexDirection: "column" },
              },
              h(
                "div",
                { style: { fontSize: 16, fontWeight: 600, color: t.fg } },
                formatValue(stat.value, stat.format),
              ),
              h(
                "div",
                { style: { fontSize: 10.5, color: c.axis } },
                stat.label,
              ),
            ),
          ),
        )
      : null;
  return h(
    "div",
    {
      style: {
        height,
        display: "flex",
        flexDirection: "column",
        fontFamily: t.font,
      },
    },
    statRow,
    h(
      "div",
      {
        style: {
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
        },
      },
      ...buckets.map((bucket, index) => {
        const barHeight = `${(Math.abs(bucket.value) / maxValue) * 100}%`;
        return h(
          "div",
          {
            key: index,
            style: {
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              height: "100%",
            },
            title: `${bucket.label}: ${formatValue(bucket.value, valueFormat)}`,
          },
          h("div", {
            style: {
              width: "100%",
              height: barHeight,
              minHeight: 2,
              borderRadius: "3px 3px 0 0",
              background: fill,
            },
          }),
          h(
            "div",
            {
              style: {
                fontSize: 9.5,
                color: c.axis,
                marginTop: 4,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
              },
            },
            bucket.label,
          ),
        );
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// DotStrip — one track per row with sample dots
// ---------------------------------------------------------------------------

export interface DotStripRow {
  label: string;
  meta?: string;
  dots: number[];
  tone?: "ok" | "warn" | "danger";
}

export interface DotStripProps {
  rows: DotStripRow[];
  max: number;
  format?: MetricFormat;
}

export function DotStrip({ rows, max, format }: DotStripProps) {
  const t = tokens();
  const c = chrome();
  if (!rows || rows.length === 0) return emptyState("No data");
  const scaleMax =
    max > 0
      ? max
      : Math.max(1, ...rows.flatMap((row) => row.dots.map(Math.abs)));
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontFamily: t.font,
      },
    },
    ...rows.map((row, index) => {
      const dotColor = toneColor(row.tone);
      return h(
        "div",
        {
          key: index,
          style: { display: "flex", alignItems: "center", gap: 8 },
        },
        h(
          "div",
          { style: { width: 120, flexShrink: 0 } },
          h("div", { style: { fontSize: 12, color: t.fg } }, row.label),
          row.meta &&
            h("div", { style: { fontSize: 10.5, color: t.faint } }, row.meta),
        ),
        h(
          "div",
          {
            style: {
              position: "relative",
              flex: 1,
              height: 12,
              borderRadius: 6,
              background: c.grid,
            },
          },
          ...row.dots.map((dot, dotIndex) => {
            const left = Math.max(0, Math.min(100, (dot / scaleMax) * 100));
            return h("div", {
              key: dotIndex,
              title: formatValue(dot, format),
              style: {
                position: "absolute",
                top: 2,
                left: `calc(${left}% - 4px)`,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dotColor,
                opacity: 0.85,
              },
            });
          }),
        ),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// KeyLegend — a small color-key row
// ---------------------------------------------------------------------------

export interface KeyLegendProps {
  items: Array<{ label: string; color: string }>;
}

export function KeyLegend({ items }: KeyLegendProps) {
  const t = tokens();
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: "2px 12px",
        fontSize: 10.5,
        color: t.fg,
        fontFamily: t.font,
      },
    },
    ...(items ?? []).map((item, index) =>
      h(
        "div",
        {
          key: index,
          style: { display: "flex", alignItems: "center", gap: 4 },
        },
        h("span", {
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: item.color,
            flexShrink: 0,
          },
        }),
        item.label,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Table (public) — typed columns, per-cell highlight, mono columns
// ---------------------------------------------------------------------------

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  format?: MetricFormat;
  width?: number | string;
}

export interface TableProps {
  columns: TableColumn[];
  rows: Row[];
  highlight?: (row: Row, key: string) => "warn" | "danger" | "ok" | undefined;
  mono?: string[];
  height?: number;
}

export function Table({ columns, rows, highlight, mono, height }: TableProps) {
  const t = tokens();
  const c = chrome();
  if (!rows || rows.length === 0) return emptyState("No data", height);
  const monoSet = new Set(mono ?? []);
  return h(
    "div",
    { style: { height, overflow: "auto", fontFamily: t.font } },
    h(
      "table",
      { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          ...columns.map((col) =>
            h(
              "th",
              {
                key: col.key,
                style: {
                  textAlign: col.align ?? "left",
                  borderBottom: `1px solid ${c.grid}`,
                  padding: "4px 8px",
                  color: c.axis,
                  fontWeight: 500,
                  width: col.width,
                },
              },
              col.label,
            ),
          ),
        ),
      ),
      h(
        "tbody",
        {},
        ...rows.map((row, rowIndex) =>
          h(
            "tr",
            { key: rowIndex },
            // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent conditional branches with no shared state.
            ...columns.map((col) => {
              const tone = highlight ? highlight(row, col.key) : undefined;
              const raw = row[col.key];
              const text =
                typeof raw === "number"
                  ? formatValue(raw, col.format)
                  : String(raw ?? "");
              return h(
                "td",
                {
                  key: col.key,
                  style: {
                    borderBottom: `1px solid ${c.grid}`,
                    padding: "4px 8px",
                    textAlign: col.align ?? "left",
                    color: tone ? toneColor(tone) : t.fg,
                    fontWeight: tone ? 600 : 400,
                    fontFamily: monoSet.has(col.key) ? t.mono : undefined,
                  },
                },
                text,
              );
            }),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// ScatterDots — one or more scatter series
// ---------------------------------------------------------------------------

export interface ScatterDotsProps {
  data: Row[];
  x: string;
  y: string;
  seriesKey?: string;
  colors?: Record<string, string> | string[];
  referenceLines?: ReferenceLine[];
  yDomain?: [number, number];
  xIsTime?: boolean;
  xFormat?: MetricFormat;
  yFormat?: MetricFormat;
  legend?: boolean;
  height?: number;
}

function scatterColor(
  colors: Record<string, string> | string[] | undefined,
  key: string,
  index: number,
): string {
  if (Array.isArray(colors))
    return colorAt(colors.length > 0 ? colors : DEFAULT_COLORS, index);
  if (colors?.[key]) return colors[key] as string;
  return fixedColor(key);
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function ScatterDots({
  data,
  x,
  y,
  seriesKey,
  colors,
  referenceLines,
  yDomain,
  xIsTime,
  xFormat,
  yFormat,
  legend,
  height = DEFAULT_HEIGHT,
}: ScatterDotsProps) {
  const R = recharts();
  const c = chrome();
  if (!data || data.length === 0) return emptyState("No data", height);

  const groups = seriesKey
    ? Array.from(new Set(data.map((row) => String(row[seriesKey])))).map(
        (name) => ({
          name,
          rows: data.filter((row) => String(row[seriesKey]) === name),
        }),
      )
    : [{ name: y, rows: data }];
  const showLegend = legend ?? groups.length > 1;

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend &&
      legendBar(
        groups.map((group) => group.name),
        groups.map((group, index) => scatterColor(colors, group.name, index)),
        c,
      ),
    h(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.ScatterChart,
          { margin: { top: 6, right: 12, bottom: 0, left: 0 } },
          h(R.CartesianGrid, { stroke: c.grid }),
          h(R.XAxis, {
            type: xIsTime ? "number" : "category",
            dataKey: x,
            axisLine: false,
            tickLine: false,
            tick: { fill: c.axis, fontSize: 11 },
            domain: xIsTime ? ["dataMin", "dataMax"] : undefined,
            tickFormatter: xIsTime
              ? (value: unknown) => formatAxisValue(value, xFormat)
              : axisTickFormatter(x, data),
          }),
          h(R.YAxis, {
            type: "number",
            dataKey: y,
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            domain: yDomain,
            tickFormatter: (value: unknown) => formatAxisValue(value, yFormat),
          }),
          h(R.Tooltip, {
            cursor: { strokeDasharray: "3 3" },
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
          ...referenceLineNodes(R, referenceLines),
          ...groups.map((group, index) =>
            h(R.Scatter, {
              key: group.name,
              name: group.name,
              data: group.rows,
              fill: scatterColor(colors, group.name, index),
              isAnimationActive: false,
            }),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// LineChart — multi-series lines, optional band, dual axis, scatter overlay
// ---------------------------------------------------------------------------

export interface LineSeries {
  key: string;
  label?: string;
  color?: string;
  dashed?: boolean;
  width?: number;
  axis?: "left" | "right";
}

export interface LineChartProps {
  data: Row[];
  x: string;
  series: LineSeries[];
  band?: { lowKey: string; highKey: string; color?: string; opacity?: number };
  referenceLines?: ReferenceLine[];
  referenceAreas?: ReferenceArea[];
  dots?: { key: string; color?: string };
  format?: MetricFormat;
  rightFormat?: MetricFormat;
  xFormat?: MetricFormat;
  legend?: boolean;
  height?: number;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent conditional branches with no shared state.
export function LineChart({
  data,
  x,
  series,
  band,
  referenceLines,
  referenceAreas,
  dots,
  format,
  rightFormat,
  xFormat,
  legend,
  height = DEFAULT_HEIGHT,
}: LineChartProps) {
  const R = recharts();
  const c = chrome();
  if (!data || data.length === 0) return emptyState("No data", height);
  const palette = DEFAULT_COLORS;
  const hasRight = series.some((line) => line.axis === "right");
  const primaryKey = series[0]?.key;

  // A band draws as a transparent base (low) plus a filled range (high-low)
  // sharing a stackId, and an optional scatter overlay marks flagged rows.
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent conditional branches with no shared state.
  const rows = data.map((row) => {
    const out: Row = { ...row };
    if (band) {
      const low = toNumber(row[band.lowKey]);
      const high = toNumber(row[band.highKey]);
      out.__bandBase = low;
      out.__bandRange = Math.max(0, high - low);
    }
    if (dots) {
      out.__dot = row[dots.key]
        ? primaryKey
          ? toNumber(row[primaryKey])
          : 0
        : null;
    }
    return out;
  });
  const showLegend = legend ?? series.length > 1;
  const bandColor = band?.color ?? tokens().faint;

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend &&
      legendBar(
        series.map((line) => line.label ?? line.key),
        series.map((line, index) => line.color ?? colorAt(palette, index)),
        c,
      ),
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
          ...referenceAreaNodes(R, referenceAreas),
          h(R.XAxis, {
            dataKey: x,
            axisLine: false,
            tickLine: false,
            minTickGap: 24,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: xFormat
              ? (value: unknown) => formatAxisValue(value, xFormat)
              : axisTickFormatter(x, data),
          }),
          h(R.YAxis, {
            yAxisId: "left",
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: (value: unknown) => formatAxisValue(value, format),
          }),
          hasRight &&
            h(R.YAxis, {
              yAxisId: "right",
              orientation: "right",
              axisLine: false,
              tickLine: false,
              width: 48,
              tick: { fill: c.axis, fontSize: 11 },
              tickFormatter: (value: unknown) =>
                formatAxisValue(value, rightFormat ?? format),
            }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
          band &&
            h(R.Area, {
              yAxisId: "left",
              dataKey: "__bandBase",
              stackId: "band",
              stroke: "none",
              fill: "none",
              fillOpacity: 0,
              isAnimationActive: false,
              legendType: "none",
              tooltipType: "none",
            }),
          band &&
            h(R.Area, {
              yAxisId: "left",
              dataKey: "__bandRange",
              stackId: "band",
              stroke: "none",
              fill: bandColor,
              fillOpacity: band.opacity ?? 0.14,
              isAnimationActive: false,
              legendType: "none",
              tooltipType: "none",
            }),
          ...series.map((line, index) =>
            h(R.Line, {
              key: line.key,
              yAxisId: line.axis === "right" ? "right" : "left",
              dataKey: line.key,
              name: line.label ?? line.key,
              stroke: line.color ?? colorAt(palette, index),
              strokeWidth: line.width ?? 2,
              strokeDasharray: line.dashed ? "4 3" : undefined,
              dot: false,
              isAnimationActive: false,
              connectNulls: true,
            }),
          ),
          dots &&
            h(R.Scatter, {
              yAxisId: "left",
              dataKey: "__dot",
              fill: dots.color ?? tokens().danger,
              isAnimationActive: false,
              legendType: "none",
            }),
          ...referenceLineNodes(R, referenceLines),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Bars — generic bar chart (per-bar cell colors, projected fade, ref lines)
// ---------------------------------------------------------------------------

/** Per-row `<Cell>` nodes for a single-series bar, with projected-row fade. */
function barCells(
  R: any,
  data: Row[],
  opts: {
    color: string;
    colorBy?: (row: Row) => string;
    projectedKey?: string;
  },
): any[] {
  const { color, colorBy, projectedKey } = opts;
  return data.map((row, rowIndex) =>
    h(R.Cell, {
      key: rowIndex,
      fill: colorBy ? colorBy(row) : color,
      fillOpacity: projectedKey && row[projectedKey] ? 0.4 : 1,
    }),
  );
}

export interface BarsProps {
  data: Row[];
  x: string;
  y?: string;
  series?: Array<{ key: string; label?: string; color?: string }>;
  stacked?: boolean;
  colorBy?: (row: Row) => string;
  referenceLines?: ReferenceLine[];
  format?: MetricFormat;
  legend?: boolean;
  /** Rows where this key is truthy render faded (a projected region). */
  projectedKey?: string;
  height?: number;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function Bars({
  data,
  x,
  y,
  series,
  stacked,
  colorBy,
  referenceLines,
  format,
  legend,
  projectedKey,
  height = DEFAULT_HEIGHT,
}: BarsProps) {
  const R = recharts();
  const c = chrome();
  if (!data || data.length === 0) return emptyState("No data", height);
  const palette = DEFAULT_COLORS;
  const seriesList =
    series && series.length > 0 ? series : [{ key: y ?? "value" }];
  const showLegend = legend ?? seriesList.length > 1;

  const bars = seriesList.map((entry, index) => {
    const color = entry.color ?? colorAt(palette, index);
    const cells =
      seriesList.length === 1
        ? barCells(R, data, { color, colorBy, projectedKey })
        : [];
    return h(
      R.Bar,
      {
        key: entry.key,
        dataKey: entry.key,
        name: entry.label ?? entry.key,
        fill: color,
        isAnimationActive: false,
        ...(stacked ? { stackId: "stack" } : {}),
      },
      ...cells,
    );
  });

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend &&
      legendBar(
        seriesList.map((entry) => entry.label ?? entry.key),
        seriesList.map(
          (entry, index) => entry.color ?? colorAt(palette, index),
        ),
        c,
      ),
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
            tickFormatter: (value: unknown) => formatAxisValue(value, format),
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
            formatter: (value: unknown) => formatValue(value as number, format),
          }),
          ...bars,
          ...referenceLineNodes(R, referenceLines),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// ComboChart — bars on the left axis, lines on the right (dual axis)
// ---------------------------------------------------------------------------

export interface ComboChartProps {
  data: Row[];
  x: string;
  bars: Array<{ key: string; label?: string; color?: string }>;
  lines: Array<{ key: string; label?: string; color?: string; axis?: "right" }>;
  leftFormat?: MetricFormat;
  rightFormat?: MetricFormat;
  legend?: boolean;
  height?: number;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function ComboChart({
  data,
  x,
  bars,
  lines,
  leftFormat,
  rightFormat,
  legend,
  height = DEFAULT_HEIGHT,
}: ComboChartProps) {
  const R = recharts();
  const c = chrome();
  if (!data || data.length === 0) return emptyState("No data", height);
  const palette = DEFAULT_COLORS;
  const keys = [
    ...bars.map((bar) => bar.label ?? bar.key),
    ...lines.map((line) => line.label ?? line.key),
  ];
  const legendColors = [
    ...bars.map((bar, index) => bar.color ?? colorAt(palette, index)),
    ...lines.map(
      (line, index) => line.color ?? colorAt(palette, bars.length + index),
    ),
  ];
  const showLegend = legend ?? keys.length > 1;

  return h(
    "div",
    { style: { height, display: "flex", flexDirection: "column" } },
    showLegend && legendBar(keys, legendColors, c),
    h(
      "div",
      { style: { flex: 1, minHeight: 0 } },
      h(
        R.ResponsiveContainer,
        { width: "100%", height: "100%" },
        h(
          R.ComposedChart,
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
            yAxisId: "left",
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: (value: unknown) =>
              formatAxisValue(value, leftFormat),
          }),
          h(R.YAxis, {
            yAxisId: "right",
            orientation: "right",
            axisLine: false,
            tickLine: false,
            width: 48,
            tick: { fill: c.axis, fontSize: 11 },
            tickFormatter: (value: unknown) =>
              formatAxisValue(value, rightFormat ?? leftFormat),
          }),
          h(R.Tooltip, {
            contentStyle: {
              background: c.tooltipBg,
              border: `1px solid ${c.tooltipBorder}`,
            },
            labelStyle: { color: c.text },
          }),
          ...bars.map((bar, index) =>
            h(R.Bar, {
              key: bar.key,
              yAxisId: "left",
              dataKey: bar.key,
              name: bar.label ?? bar.key,
              fill: bar.color ?? colorAt(palette, index),
              isAnimationActive: false,
            }),
          ),
          ...lines.map((line, index) =>
            h(R.Line, {
              key: line.key,
              yAxisId: "right",
              dataKey: line.key,
              name: line.label ?? line.key,
              stroke: line.color ?? colorAt(palette, bars.length + index),
              strokeWidth: 2,
              dot: false,
              isAnimationActive: false,
            }),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Gantt — session timeline with active/idle segments and a density strip
// ---------------------------------------------------------------------------

export interface GanttSegment {
  start: number;
  end: number;
  kind: "active" | "idle";
}

export interface GanttRow {
  label: string;
  sub?: string;
  color?: string;
  segments: GanttSegment[];
  value?: string;
}

export interface GanttProps {
  rows: GanttRow[];
  rangeStart: number;
  rangeEnd: number;
  ticks?: Array<{ at: number; label: string }>;
  density?: number[];
  densityLabel?: string;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function Gantt({
  rows,
  rangeStart,
  rangeEnd,
  ticks,
  density,
  densityLabel,
}: GanttProps) {
  const t = tokens();
  const c = chrome();
  if (!rows || rows.length === 0) return emptyState("No data");
  const span = rangeEnd - rangeStart || 1;
  const pctOf = (value: number) => ((value - rangeStart) / span) * 100;
  const labelWidth = 130;

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
  const trackFor = (row: GanttRow, index: number) => {
    const color = row.color ?? colorAt(t.ramp, index);
    return h(
      "div",
      {
        key: index,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        },
      },
      h(
        "div",
        { style: { width: labelWidth, flexShrink: 0, minWidth: 0 } },
        h(
          "div",
          {
            style: {
              fontSize: 12,
              color: t.fg,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            },
          },
          row.label,
        ),
        row.sub &&
          h("div", { style: { fontSize: 10, color: t.faint } }, row.sub),
      ),
      h(
        "div",
        {
          style: {
            position: "relative",
            flex: 1,
            height: 14,
            borderRadius: 3,
            background: c.grid,
          },
        },
        ...row.segments.map((segment, segIndex) => {
          const left = Math.max(0, Math.min(100, pctOf(segment.start)));
          const width = Math.max(
            0.5,
            Math.min(100 - left, pctOf(segment.end) - left),
          );
          return h("div", {
            key: segIndex,
            title: `${row.label}: ${segment.kind}`,
            style: {
              position: "absolute",
              top: 0,
              left: `${left}%`,
              width: `${width}%`,
              height: "100%",
              borderRadius: 3,
              background: color,
              opacity: segment.kind === "active" ? 0.85 : 0.2,
            },
          });
        }),
      ),
      row.value &&
        h(
          "div",
          {
            style: {
              width: 56,
              flexShrink: 0,
              textAlign: "right",
              fontSize: 11,
              color: t.fg,
            },
          },
          row.value,
        ),
    );
  };

  const densityMax =
    density && density.length > 0 ? Math.max(1, ...density) : 1;
  const densityStrip =
    density && density.length > 0
      ? h(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
            },
          },
          h(
            "div",
            {
              style: {
                width: labelWidth,
                flexShrink: 0,
                fontSize: 10.5,
                color: t.faint,
              },
            },
            densityLabel ?? "in parallel",
          ),
          h(
            "div",
            { style: { display: "flex", flex: 1, height: 10, gap: 1 } },
            ...density.map((n, index) =>
              h("div", {
                key: index,
                title: `${n} in parallel`,
                style: {
                  flex: 1,
                  height: "100%",
                  background: t.accent,
                  opacity: n === 0 ? 0.07 : 0.2 + (n / densityMax) * 0.75,
                },
              }),
            ),
          ),
        )
      : null;

  const tickRow =
    ticks && ticks.length > 0
      ? h(
          "div",
          {
            style: {
              position: "relative",
              height: 14,
              marginLeft: labelWidth + 8,
              marginTop: 2,
            },
          },
          ...ticks.map((tick, index) =>
            h(
              "div",
              {
                key: index,
                style: {
                  position: "absolute",
                  left: `${Math.max(0, Math.min(100, pctOf(tick.at)))}%`,
                  fontSize: 9.5,
                  color: c.axis,
                  transform: "translateX(-50%)",
                },
              },
              tick.label,
            ),
          ),
        )
      : null;

  return h(
    "div",
    { style: { fontFamily: t.font } },
    ...rows.map((row, index) => trackFor(row, index)),
    tickRow,
    densityStrip,
  );
}

// ---------------------------------------------------------------------------
// AutoTable (internal — LwqlChart's fallback kind; not exported on its own)
// ---------------------------------------------------------------------------

function AutoTable({ data, height }: { data: Row[]; height?: number }) {
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

export type LwqlChartKind =
  | "area"
  | "bars"
  | "donut"
  | "leaderboard"
  | "table"
  | "line"
  | "histogram"
  | "barlist"
  | "stat";

export interface LwqlChartProps {
  data: Row[];
  kind?: LwqlChartKind;
  x?: string;
  y?: string | string[];
  series?: string;
  colors?: string[];
  height?: number;
  format?: MetricFormat;
}

interface InferredShape {
  kind: LwqlChartKind;
  x: string;
  y: string[];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: enumerates independent shape-detection rules over the data's columns; the branches don't interact.
function inferShape(
  data: Row[],
  x?: string,
  y?: string | string[],
): InferredShape {
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dispatches on kind/x/y/series through independent fallback checks; the branches don't interact.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: chart primitive assembles its SVG/DOM tree inline, matching the sibling components in this file.
export function LwqlChart({
  data,
  kind,
  x,
  y,
  series,
  colors,
  height = DEFAULT_HEIGHT,
  format,
}: LwqlChartProps) {
  const inferred = inferShape(data, x, y);
  const resolvedKind = kind ?? inferred.kind;
  const resolvedX = x ?? inferred.x;
  const resolvedY = y ? (Array.isArray(y) ? y : [y]) : inferred.y;
  const primaryY = (resolvedY[0] as string) ?? "";

  switch (resolvedKind) {
    case "area":
      return h(AreaTimeseries, {
        data,
        x: resolvedX,
        series: series ?? resolvedY,
        colors,
        height,
        format,
      });
    case "bars":
      return h(StackedBars, {
        data,
        x: resolvedX,
        series: series ? [series] : resolvedY,
        colors,
        height,
        format,
      });
    case "line":
      return h(LineChart, {
        data,
        x: resolvedX,
        series: (series ? [series] : resolvedY).map((key) => ({ key })),
        colors,
        height,
        format,
      });
    case "donut":
      return h(Donut, {
        data,
        nameKey: resolvedX,
        valueKey: primaryY,
        colors,
        height,
        format,
      });
    case "leaderboard":
      return h(Leaderboard, {
        data,
        labelKey: resolvedX,
        valueKey: primaryY,
        height,
        format,
      });
    case "barlist":
      return h(BarList, {
        rows: data.map((row) => ({
          label: String(row[resolvedX] ?? ""),
          value: toNumber(row[primaryY]),
        })),
        format,
      });
    case "histogram":
      return h(Histogram, {
        buckets: data.map((row) => ({
          label: String(row[resolvedX] ?? ""),
          value: toNumber(row[primaryY]),
        })),
        valueFormat: format,
        height,
      });
    case "stat": {
      const first = data[0];
      return h(MetricStat, {
        value: first ? toNumber(first[primaryY]) : null,
        label: primaryY,
        format,
      });
    }
    case "table":
    default:
      return h(AutoTable, { data, height });
  }
}
