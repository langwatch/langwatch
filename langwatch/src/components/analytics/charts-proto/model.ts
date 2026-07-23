/**
 * charts-proto — S1 guided query-builder widget (PROTOTYPE)
 *
 * Shared model for the prototype: the widget spec + the β "trace query" (TRQL)
 * allowlist, mirrored 1:1 from the spike (PR #5709,
 * `server/app-layer/traces/trace-query/schema.ts`) so every knob a user turns
 * maps to a real, tenant-safe aggregation. Human labels/units are added here —
 * the real allowlist carries only raw keys.
 *
 * This is prototype code: the data layer is STUBBED (see `stubData.ts`). Nothing
 * here talks to ClickHouse or tRPC. Engine plumbing is post-pick.
 */

// ── Visualizations ─────────────────────────────────────────────────────────
export const VISUALIZATIONS = [
  { kind: "table", label: "Table", icon: "table" },
  { kind: "bar", label: "Bar", icon: "bar" },
  { kind: "line", label: "Line", icon: "line" },
  { kind: "stat", label: "Single stat", icon: "stat" },
] as const;

export type Visualization = (typeof VISUALIZATIONS)[number]["kind"];

// ── Aggregations (AGGREGATION_OPS) — schema.ts:29-40 ────────────────────────
export const AGGREGATIONS = [
  { op: "count", label: "Count", needsColumn: false },
  { op: "cardinality", label: "Unique count", needsColumn: true },
  { op: "avg", label: "Average", needsColumn: true },
  { op: "sum", label: "Sum", needsColumn: true },
  { op: "min", label: "Min", needsColumn: true },
  { op: "max", label: "Max", needsColumn: true },
  { op: "p50", label: "p50 (median)", needsColumn: true },
  { op: "p90", label: "p90", needsColumn: true },
  { op: "p95", label: "p95", needsColumn: true },
  { op: "p99", label: "p99", needsColumn: true },
] as const;

export type AggregationOp = (typeof AGGREGATIONS)[number]["op"];

/** `count`/`sum` collapse across groups by summing; every other op averages (mean of means). */
export const isAdditiveAgg = (op: AggregationOp): boolean =>
  op === "count" || op === "sum";

// ── Metric columns (METRIC_COLUMNS) — schema.ts:50-58 ───────────────────────
// `polarity`: 1 when a higher value is an improvement (throughput), -1 when a
// higher value is worse (cost, latency, volume). Drives delta colouring for
// the single-stat viz — a metric's "up" is not always "good".
export const METRICS = [
  { column: "durationMs", label: "Duration", unit: "ms", polarity: -1 },
  { column: "cost", label: "Cost", unit: "$", polarity: -1 },
  { column: "promptTokens", label: "Prompt tokens", unit: "tok", polarity: -1 },
  { column: "completionTokens", label: "Completion tokens", unit: "tok", polarity: -1 },
  { column: "totalTokens", label: "Total tokens", unit: "tok", polarity: -1 },
  { column: "tokensPerSecond", label: "Tokens / sec", unit: "tok/s", polarity: 1 },
] as const;

export type MetricColumn = (typeof METRICS)[number]["column"];

// ── Group-by dimensions (DIMENSION_COLUMNS) — schema.ts:68-72, .max(3) ───────
export const DIMENSIONS = [
  { column: "model", label: "Model" },
  { column: "topicId", label: "Topic" },
  { column: "hasError", label: "Error status" },
] as const;

export type DimensionColumn = (typeof DIMENSIONS)[number]["column"];

export const MAX_GROUP_BY = 3; // schema.ts:115 — groupBy.max(3)
export const MAX_AGGREGATIONS = 10; // schema.ts:114 — aggregations.max(10)

// ── The widget spec (persisted as CustomGraph.graph.kind="trace-query") ──────
export interface AggregationSpec {
  op: AggregationOp;
  /** required for every op except `count` (needsColumn) */
  column?: MetricColumn;
}

export interface WidgetSpec {
  id: string;
  title: string;
  visualization: Visualization;
  aggregations: AggregationSpec[]; // 1..MAX_AGGREGATIONS
  groupBy: DimensionColumn[]; // 0..MAX_GROUP_BY
  filter: string; // liqe string, e.g. "cost:>0.1"
  timeRangeMode: "inherit" | "custom";
  /** When true, the widget queries this project's real traces via the trace-query engine instead of sample data. Table/Bar/Single-stat only -- no time-bucket dimension exists yet for Line. */
  useRealData?: boolean;
  /** grid footprint, in grid cells (prototype grid is 12-col) */
  colSpan: number;
  rowSpan: number;
}

// ── Small lookup helpers ────────────────────────────────────────────────────
export const aggMeta = (op: AggregationOp) =>
  AGGREGATIONS.find((a) => a.op === op)!;
export const metricMeta = (column: MetricColumn) =>
  METRICS.find((m) => m.column === column)!;
export const dimensionMeta = (column: DimensionColumn) =>
  DIMENSIONS.find((d) => d.column === column)!;

/** The column key a returned row uses for an aggregation (mirrors compile.ts defaultAlias). */
export const aggAlias = (agg: AggregationSpec, index: number): string =>
  `${agg.op}_${agg.column ?? ""}_${index}`.replace(/[^a-zA-Z0-9_]/g, "_");

/** A human-friendly one-line description of an aggregation, e.g. "p95 Duration". */
export const aggLabel = (agg: AggregationSpec): string => {
  const meta = aggMeta(agg.op);
  if (!meta.needsColumn || !agg.column) return meta.label;
  return `${meta.label} ${metricMeta(agg.column).label.toLowerCase()}`;
};

/** Auto-suggested widget title from the spec, e.g. "p95 Duration by Model". */
export const suggestTitle = (spec: {
  aggregations: AggregationSpec[];
  groupBy: DimensionColumn[];
}): string => {
  const agg = spec.aggregations[0];
  const head = agg ? aggLabel(agg) : "Traces";
  if (spec.groupBy.length === 0) return head;
  const by = spec.groupBy.map((d) => dimensionMeta(d).label).join(" & ");
  return `${head} by ${by}`;
};
