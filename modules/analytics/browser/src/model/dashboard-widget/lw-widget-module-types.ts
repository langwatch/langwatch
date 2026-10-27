/**
 * Monaco typings for the frame's built-in modules and UMD globals (React comes from
 * @types/react), plus a catch-all for esm.sh packages. A unit test fails when the
 * frame's `CHART_FRAME_BUILTIN_MODULES` or charts exports drift from this file.
 */

export const CSSTYPE_STUB_URI = "file:///node_modules/csstype/index.d.ts";

/** React's own typings import csstype; a loose stand-in keeps `style` unchecked. */
export const CSSTYPE_STUB_DTS = `
export interface Properties<TLength = string | number> {
  [property: string]: TLength | string | number | undefined;
}
`;

const RECHARTS_COMPONENTS = [
  "Surface",
  "Layer",
  "Legend",
  "DefaultLegendContent",
  "Tooltip",
  "DefaultTooltipContent",
  "ResponsiveContainer",
  "Cell",
  "Text",
  "Label",
  "LabelList",
  "Customized",
  "Sector",
  "Curve",
  "Rectangle",
  "Polygon",
  "Dot",
  "Cross",
  "Symbols",
  "PolarGrid",
  "PolarRadiusAxis",
  "PolarAngleAxis",
  "Pie",
  "Radar",
  "RadialBar",
  "Brush",
  "ReferenceLine",
  "ReferenceDot",
  "ReferenceArea",
  "CartesianAxis",
  "CartesianGrid",
  "Line",
  "Area",
  "Bar",
  "Scatter",
  "XAxis",
  "YAxis",
  "ZAxis",
  "ErrorBar",
  "LineChart",
  "BarChart",
  "PieChart",
  "Treemap",
  "Sankey",
  "RadarChart",
  "ScatterChart",
  "AreaChart",
  "RadialBarChart",
  "ComposedChart",
  "SunburstChart",
  "Funnel",
  "FunnelChart",
  "Trapezoid",
] as const;

const RECHARTS_DTS = `declare module "recharts" {
  type RechartsComponent = React.ComponentType<Record<string, any>>;
${RECHARTS_COMPONENTS.map((name) => `  export const ${name}: RechartsComponent;`).join("\n")}
  export const Global: Record<string, unknown>;
}`;

const CHARTS_DTS = `declare module "@langwatch/charts" {
  type Row = Record<string, unknown>;
  type MetricFormat = "number" | "currency" | "percent" | "duration";
  type Chart<Props> = React.FunctionComponent<Props>;

  export interface SparklineProps {
    data: readonly Row[] | readonly number[];
    x?: string;
    y?: string;
    color?: string;
    height?: number;
  }
  export interface MetricStatProps {
    value: number | string | null | undefined;
    label: string;
    delta?: number;
    deltaDirection?: "up" | "down";
    format?: MetricFormat;
    sparkline?: readonly number[] | readonly Row[];
    sparklineKey?: string;
    colors?: readonly string[];
    height?: number;
  }
  export interface AreaTimeseriesProps {
    data: readonly Row[];
    x: string;
    series: string | readonly string[];
    stacked?: boolean;
    projectionFrom?: string | number;
    colors?: readonly string[];
    height?: number;
    /** How the hover prints a value. */
    format?: MetricFormat;
    /**
     * What the hover says over a bucket with no data, from its date. Default "No data on Oct 7".
     * A null value is a gap: the area breaks and a faint dashed line bridges it.
     */
    gapLabel?: (date: string) => string;
  }
  export interface StackedBarsProps {
    data: readonly Row[];
    x: string;
    series: readonly string[];
    projectionFrom?: string | number;
    colors?: readonly string[];
    height?: number;
  }
  export interface GroupedBarsProps {
    data: readonly Row[];
    x: string;
    series: readonly string[];
    colors?: readonly string[];
    height?: number;
  }
  export interface ProjectionBarsProps {
    data: readonly Row[];
    x: string;
    y: string;
    projectionFrom: string | number;
    budget?: number;
    colors?: readonly string[];
    height?: number;
  }
  export interface DonutProps {
    data: readonly Row[];
    nameKey: string;
    valueKey: string;
    centerLabel?: string;
    colors?: readonly string[];
    height?: number;
  }
  export interface LeaderboardProps {
    data: readonly Row[];
    labelKey: string;
    valueKey: string;
    max?: number;
    format?: MetricFormat;
    height?: number;
    navigateTo?: { target: string; params: (row: Row) => object };
    /** \`completeness.unpriced\`: each model gets a "no price" row with a dash, never $0. */
    unpriced?: { models: readonly string[] };
  }
  export interface HeatmapProps {
    data: readonly Row[];
    xKey: string;
    yKey: string;
    valueKey: string;
    xLabels?: readonly string[];
    yLabels?: readonly string[];
    colorScale?: [string, string];
    /** "count": a cell with no row is 0. "measure" (default): it is a gap, drawn empty. */
    kind?: SeriesKind;
    height?: number;
  }
  /** A count may be a real 0; a measure (rate, average, percentile) with no data is a gap. */
  export type SeriesKind = "count" | "measure";
  /** A series key, or a key with its kind. A bare key is a measure, the safe default. */
  export type SeriesSpec = string | { key: string; kind?: SeriesKind };
  export interface CompletenessBucket {
    start: string;
    n: number;
  }
  export type LwqlChartKind = "area" | "bars" | "donut" | "leaderboard" | "table";
  export interface LwqlChartProps {
    data: readonly Row[];
    kind?: LwqlChartKind;
    x?: string;
    y?: string | readonly string[];
    series?: string;
    colors?: readonly string[];
    height?: number;
    /** \`completeness.unpriced\`: a leaderboard lists each model with "no price". */
    unpriced?: { models: readonly string[] };
  }
  /** A query's completeness report, as \`LW.useChartQuery\` returns it. */
  export interface CompletenessReport {
    readonly state: "complete" | "partial" | "missing" | "no_traffic";
    readonly unit: string;
    readonly total: number;
    readonly fields: readonly {
      readonly field: string;
      readonly label: string;
      readonly present: number;
    }[];
    readonly buckets?: readonly CompletenessBucket[];
    readonly unpriced?: { readonly count: number; readonly models: readonly string[] };
  }

  export const Sparkline: Chart<SparklineProps>;
  export const MetricStat: Chart<MetricStatProps>;
  export const AreaTimeseries: Chart<AreaTimeseriesProps>;
  export const StackedBars: Chart<StackedBarsProps>;
  export const GroupedBars: Chart<GroupedBarsProps>;
  export const ProjectionBars: Chart<ProjectionBarsProps>;
  export const Donut: Chart<DonutProps>;
  export const Leaderboard: Chart<LeaderboardProps>;
  export const Heatmap: Chart<HeatmapProps>;
  export const LwqlChart: Chart<LwqlChartProps>;
  export function parseHexRgb(hex: string): [number, number, number] | null;
  export function interpolateColor(from: string, to: string, t: number): string;
  /** A value as a number, or null when it is missing (null, undefined, NaN, ""). */
  export function toNumber(value: unknown): number | null;
  /**
   * The rows with every bucket of \`completeness.buckets\` present, in time order: a bucket with
   * no row gets one, its count series 0 and its measure series null (a gap in the line).
   */
  export function mergeBuckets(input: {
    rows: readonly Row[];
    buckets: readonly CompletenessBucket[] | null | undefined;
    x: string;
    series?: readonly SeriesSpec[];
  }): Row[];
  /**
   * Whether a sum over \`field\` is a lower bound, so its figure reads "$830+": the report is
   * partial and some rows lack the field, or the field is a cost and some traces have no price.
   * Never on an average or a rate.
   */
  export function isLowerBound(input: {
    completeness: CompletenessReport | null | undefined;
    field: string;
  }): boolean;
  /**
   * The mean of \`key\` over the rows that have it, so an empty bucket never pulls a big number
   * down; with \`weight\` (a row count column) each row counts by it. Null when none has a value.
   */
  export function averageOf(input: {
    rows: readonly Row[];
    key: string;
    weight?: string;
  }): number | null;
}`;

/**
 * Bare packages other than the built-ins load from esm.sh at runtime, where
 * no types reach the editor, so they resolve as untyped rather than as errors.
 */
const CATCH_ALL_DTS = `declare module "*";`;

const FRAME_GLOBALS_DTS = `
declare const ReactDOM: typeof import("react-dom") & typeof import("react-dom/client");
declare const Recharts: typeof import("recharts");
declare const LWCharts: typeof import("@langwatch/charts");
`;

export const LW_WIDGET_MODULES_DTS = [
  RECHARTS_DTS,
  CHARTS_DTS,
  CATCH_ALL_DTS,
  FRAME_GLOBALS_DTS,
].join("\n");
