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
  }
  export interface HeatmapProps {
    data: readonly Row[];
    xKey: string;
    yKey: string;
    valueKey: string;
    xLabels?: readonly string[];
    yLabels?: readonly string[];
    colorScale?: [string, string];
    height?: number;
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
