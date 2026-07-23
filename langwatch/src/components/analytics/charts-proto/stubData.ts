/**
 * charts-proto — deterministic STUBBED data engine (PROTOTYPE).
 *
 * The whole data layer is faked here. `runStubQuery` turns a WidgetSpec + time
 * window into internally-consistent, realistic-looking results that:
 *   - stay STABLE across re-renders (seeded PRNG, no flicker), so the live
 *     preview morphs smoothly rather than jittering;
 *   - CHANGE when the query changes (metric / agg / groupBy / filter), so
 *     turning a knob visibly updates the chart;
 *   - scale volume with the selected time window, so the dashboard period
 *     picker visibly cascades into every widget.
 *
 * Nothing here touches ClickHouse or tRPC. When the real β engine is wired in,
 * this module is the single seam to replace: `runStubQuery` → `traceQuery.run`.
 */
import { getHexColorForString } from "~/utils/rotatingColors";
import {
  type AggregationSpec,
  type DimensionColumn,
  type MetricColumn,
  type WidgetSpec,
  aggAlias,
  aggLabel,
  isAdditiveAgg,
  metricMeta,
} from "./model";

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────
const hashString = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ── Realistic dimension value pools ─────────────────────────────────────────
interface DimValue {
  value: string;
  label: string;
}

const DIMENSION_VALUES: Record<DimensionColumn, DimValue[]> = {
  model: [
    { value: "gpt-4o", label: "gpt-4o" },
    { value: "gpt-4o-mini", label: "gpt-4o-mini" },
    { value: "claude-3-5-sonnet", label: "claude-3-5-sonnet" },
    { value: "claude-3-5-haiku", label: "claude-3-5-haiku" },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro" },
    { value: "gemini-1.5-flash", label: "gemini-1.5-flash" },
    { value: "llama-3.1-70b", label: "llama-3.1-70b" },
    { value: "mistral-large", label: "mistral-large" },
  ],
  topicId: [
    { value: "topic_billing", label: "Billing questions" },
    { value: "topic_onboarding", label: "Onboarding" },
    { value: "topic_support", label: "Technical support" },
    { value: "topic_account", label: "Account management" },
    { value: "topic_feedback", label: "Product feedback" },
    { value: "topic_refunds", label: "Refund requests" },
    { value: "topic_api", label: "API integration" },
  ],
  hasError: [
    { value: "false", label: "OK" },
    { value: "true", label: "Error" },
  ],
};

// How many values of each dimension to surface, by position in the groupBy list
// (keeps the cross-product bounded so tables/bars stay readable).
const DIM_TAKE = [8, 3, 2];

// ── Metric magnitude profiles (per-trace "typical" values) ──────────────────
const METRIC_PROFILE: Record<MetricColumn, { typical: number; spread: number }> =
  {
    durationMs: { typical: 1450, spread: 900 },
    cost: { typical: 0.028, spread: 0.05 },
    promptTokens: { typical: 780, spread: 480 },
    completionTokens: { typical: 340, spread: 260 },
    totalTokens: { typical: 1120, spread: 700 },
    tokensPerSecond: { typical: 47, spread: 22 },
  };

// ── Result shape the renderer consumes ──────────────────────────────────────
export interface StubGroup {
  key: string; // stable identity key (dimension values joined)
  label: string; // human label, e.g. "gpt-4o · Billing questions"
  color: string; // hex, stable per identity
  dims: Record<string, string>; // dimension column -> value label
  values: Record<string, number>; // aggAlias -> numeric value
}

export interface StubColumn {
  key: string;
  label: string;
  kind: "dimension" | "metric";
  agg?: AggregationSpec;
}

export interface StubBucket {
  t: number;
  label: string;
  byGroup: Record<string, number>; // groupKey -> value (primary agg)
}

export interface StubResult {
  columns: StubColumn[];
  groups: StubGroup[];
  buckets: StubBucket[]; // for line viz (primary aggregation over time)
  primaryAgg: AggregationSpec;
  total: { value: number; deltaPct: number; spark: number[] };
}

export interface StubWindow {
  startDate: Date;
  endDate: Date;
  days: number;
}

// ── Value formatting ────────────────────────────────────────────────────────
export const formatCompactInt = (v: number): string => {
  const n = Math.round(v);
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
};

export const aggUnit = (agg: AggregationSpec): string => {
  if (agg.op === "count" || agg.op === "cardinality") return "";
  return agg.column ? metricMeta(agg.column).unit : "";
};

/** 1 (up=good) unless the metric column says otherwise; `count`/`cardinality` have no column to look up, so default neutral-good. */
export const aggPolarity = (agg: AggregationSpec): 1 | -1 => {
  if (agg.op === "count" || agg.op === "cardinality") return 1;
  return agg.column ? metricMeta(agg.column).polarity : 1;
};

export interface DeltaTrend {
  direction: "up" | "down" | "flat";
  /** null when flat — flat is neither good nor bad. */
  isGood: boolean | null;
}

/** Interprets a delta for display: `direction` mirrors the raw sign (icon), `isGood` folds in the metric's polarity (colour). */
export const deltaTrend = (deltaPct: number, agg: AggregationSpec): DeltaTrend => {
  if (deltaPct === 0) return { direction: "flat", isGood: null };
  const direction = deltaPct > 0 ? "up" : "down";
  return { direction, isGood: deltaPct * aggPolarity(agg) > 0 };
};

export const formatAggValue = (agg: AggregationSpec, v: number): string => {
  if (agg.op === "count") return formatCompactInt(v);
  if (agg.op === "cardinality") return formatCompactInt(v);
  const unit = agg.column ? metricMeta(agg.column).unit : "";
  switch (unit) {
    case "$":
      return "$" + (v < 1 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : formatCompactInt(v));
    case "ms":
      return v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms";
    case "tok":
      return formatCompactInt(v);
    case "tok/s":
      return v.toFixed(1);
    default:
      return formatCompactInt(v);
  }
};

// Multipliers that turn a per-trace mean into each aggregation's value.
const AGG_SHAPE: Record<string, number> = {
  avg: 1,
  min: 0.28,
  max: 3.3,
  p50: 0.9,
  p90: 1.85,
  p95: 2.25,
  p99: 2.95,
};

const deriveValue = (
  agg: AggregationSpec,
  mean: number,
  volume: number,
  rng: () => number,
): number => {
  switch (agg.op) {
    case "count":
      return Math.round(volume);
    case "cardinality":
      return Math.max(1, Math.round(2 + rng() * 40));
    case "sum":
      return mean * volume;
    default: {
      // Derived deterministically from the shared per-column mean so quantiles
      // over the same metric stay monotonic (p50 ≤ p90 ≤ p95 ≤ p99).
      const shape = AGG_SHAPE[agg.op] ?? 1;
      return mean * shape;
    }
  }
};

// ── Bucketing granularity from the window ───────────────────────────────────
const bucketPlan = (days: number): { count: number; stepMs: number; fmt: "hour" | "day" | "week" } => {
  if (days <= 2) return { count: 24, stepMs: 60 * 60 * 1000, fmt: "hour" };
  if (days <= 14) return { count: days, stepMs: 24 * 60 * 60 * 1000, fmt: "day" };
  if (days <= 90) return { count: Math.min(days, 45), stepMs: (days / Math.min(days, 45)) * 86400000, fmt: "day" };
  return { count: 26, stepMs: (days / 26) * 86400000, fmt: "week" };
};

const bucketLabel = (t: number, fmt: "hour" | "day" | "week"): string => {
  const d = new Date(t);
  if (fmt === "hour") return `${d.getHours().toString().padStart(2, "0")}:00`;
  const mo = d.toLocaleString("en-US", { month: "short" });
  return `${mo} ${d.getDate()}`;
};

// ── The engine ──────────────────────────────────────────────────────────────
export const runStubQuery = (spec: WidgetSpec, win: StubWindow): StubResult => {
  // `spec.filter` is deliberately excluded from the seed/volume in general — the
  // stub never parses Liqe syntax, so folding arbitrary text in would make an
  // inert control look functional (distinct strings yielding distinct-but-fake
  // results). One narrow exception: `has_error:true` / `has_error:false` is the
  // exact literal every curated template authors (see templates.ts) to mean
  // "the hasError dimension", which the stub already models faithfully via
  // groupBy. Recognizing only this one hardcoded pattern lets those widgets
  // show a real error-vs-ok split instead of silently matching their unfiltered
  // counterpart; any other filter text still changes nothing.
  const errorFilterMatch = /^has_error:(true|false)$/.exec(spec.filter.trim());
  const errorFilterValue = errorFilterMatch?.[1] as "true" | "false" | undefined;
  const appliesSyntheticErrorGroup =
    errorFilterValue !== undefined && !spec.groupBy.includes("hasError");

  const queryKey = JSON.stringify({
    a: spec.aggregations,
    g: spec.groupBy,
  });
  const primaryAgg = spec.aggregations[0] ?? { op: "count" as const };

  // Volume scales with the window (more days -> more traces), giving the period
  // picker a visible cascade.
  const windowScale = Math.max(0.15, Math.min(6, win.days / 7));

  // Build the set of groups (cross-product of the chosen dimensions, bounded).
  // When a has_error filter applies and hasError isn't already a displayed
  // group, append it as an extra level so error/ok volumes are computed
  // independently, then strip it back out of the displayed shape below.
  const combosGroupBy = appliesSyntheticErrorGroup
    ? [...spec.groupBy, "hasError" as const]
    : spec.groupBy;
  const dimLists = combosGroupBy.map((dim, i) =>
    DIMENSION_VALUES[dim].slice(0, DIM_TAKE[i] ?? 2).map((dv) => ({ dim, ...dv })),
  );

  type Combo = { dim: DimensionColumn; value: string; label: string }[];
  let combos: Combo[] = [[]];
  for (const list of dimLists) {
    const next: Combo[] = [];
    for (const base of combos) {
      for (const item of list) next.push([...base, item]);
    }
    combos = next;
  }

  if (errorFilterValue !== undefined) {
    combos = combos.filter((combo) =>
      combo.some((c) => c.dim === "hasError" && c.value === errorFilterValue),
    );
  }
  // Seed keys stay derived from the full (unstripped) combo so a filtered
  // widget gets a different volume than its unfiltered counterpart; only the
  // displayed label/dims/color drop the synthetic hasError level.
  const displayedCombos = combos.map((combo) =>
    appliesSyntheticErrorGroup ? combo.filter((c) => c.dim !== "hasError") : combo,
  );

  const columns: StubColumn[] = [
    ...spec.groupBy.map((dim) => ({
      key: dim,
      label: dim === "model" ? "Model" : dim === "topicId" ? "Topic" : "Error status",
      kind: "dimension" as const,
    })),
    ...spec.aggregations.map((agg, i) => ({
      key: aggAlias(agg, i),
      label: aggLabel(agg),
      kind: "metric" as const,
      agg,
    })),
  ];

  const groups: StubGroup[] = combos.map((combo, idx) => {
    const displayed = displayedCombos[idx]!;
    const seedKey = combo.map((c) => `${c.dim}:${c.value}`).join("|") || "__all__";
    const key = displayed.map((c) => `${c.dim}:${c.value}`).join("|") || "__all__";
    const label = displayed.map((c) => c.label).join(" · ") || "All traces";
    const colorSeed = displayed.length ? displayed[displayed.length - 1]!.label : label;
    const rng = mulberry32(hashString(queryKey + "||" + seedKey));

    // Per-group popularity → volume; per-group mean factor per metric.
    const popularity = 0.35 + rng() * 1.3;
    const volume = Math.round((120 + rng() * 5200) * popularity * windowScale);

    // One stable mean per (group, metric column) so every aggregation over the
    // same column is internally consistent (min ≤ p50 ≤ avg ≤ p95 ≤ max, etc.).
    const columnMeans: Partial<Record<MetricColumn, number>> = {};
    const meanForColumn = (column: MetricColumn): number => {
      if (columnMeans[column] === undefined) {
        const r = mulberry32(hashString(queryKey + "|mean|" + key + "|" + column));
        columnMeans[column] = METRIC_PROFILE[column].typical * (0.6 + r() * 0.95);
      }
      return columnMeans[column]!;
    };

    const values: Record<string, number> = {};
    spec.aggregations.forEach((agg, i) => {
      const alias = aggAlias(agg, i);
      if (agg.op === "count" || agg.op === "cardinality") {
        values[alias] = deriveValue(agg, 0, volume, rng);
      } else if (agg.column) {
        values[alias] = deriveValue(agg, meanForColumn(agg.column), volume, rng);
      } else {
        values[alias] = deriveValue(agg, 0, volume, rng);
      }
    });

    return {
      key,
      label,
      color: getHexColorForString(colorSeed),
      dims: Object.fromEntries(displayed.map((c) => [c.dim, c.label])),
      values,
    };
  });

  // Rank groups by the primary aggregation (New-Relic tables/bars are sorted).
  const primaryKey = aggAlias(primaryAgg, 0);
  groups.sort((a, b) => (b.values[primaryKey] ?? 0) - (a.values[primaryKey] ?? 0));

  // Time buckets for the line viz: primary aggregation per group over time.
  const plan = bucketPlan(win.days);
  const t0 = win.endDate.getTime() - plan.count * plan.stepMs;
  const buckets: StubBucket[] = [];
  for (let b = 0; b < plan.count; b++) {
    const t = t0 + b * plan.stepMs;
    const byGroup: Record<string, number> = {};
    for (const g of groups) {
      const base = g.values[primaryKey] ?? 0;
      const rng = mulberry32(hashString(g.key + primaryKey + "#" + b));
      // wave + gentle upward trend + noise, centered on the group's aggregate
      const wave = 0.78 + 0.22 * Math.sin((b / plan.count) * Math.PI * 2 + hashString(g.key) % 6);
      const trend = 0.85 + 0.3 * (b / Math.max(1, plan.count - 1));
      const noise = 0.9 + rng() * 0.2;
      byGroup[g.key] = base * wave * trend * noise;
    }
    buckets.push({ t, label: bucketLabel(t, plan.fmt), byGroup });
  }

  // Single-stat total: primary aggregation collapsed across groups.
  const isAdditive = isAdditiveAgg(primaryAgg.op);
  const totalValue = isAdditive
    ? groups.reduce((s, g) => s + (g.values[primaryKey] ?? 0), 0)
    : groups.length
      ? groups.reduce((s, g) => s + (g.values[primaryKey] ?? 0), 0) / groups.length
      : 0;
  const deltaRng = mulberry32(hashString(queryKey + "#delta"));
  const deltaPct = Math.round((deltaRng() * 44 - 18) * 10) / 10;
  const spark = buckets.map((bk) =>
    isAdditive
      ? Object.values(bk.byGroup).reduce((s, v) => s + v, 0)
      : Object.values(bk.byGroup).reduce((s, v) => s + v, 0) /
        Math.max(1, groups.length),
  );

  return { columns, groups, buckets, primaryAgg, total: { value: totalValue, deltaPct, spark } };
};
