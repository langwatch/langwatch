/**
 * ComparisonCharts - Bar charts for comparing metrics across runs
 */

import { Box, Button, HStack, Portal, Text, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RUN_COLORS } from "../../../behavior/batch-evaluation-results/use-multi-run-data.ts";
import {
  axisLabelProps,
  buildAxisLabels,
  chartHeightFor,
  truncateLabel,
} from "../../../model/batch-evaluation-results.chart-axis.ts";
import { ChartTooltip } from "../../elements/analytics/chart-tooltip.tsx";
import {
  type BatchComparisonColumn,
  type BatchEvaluationData,
  type BatchResultRow,
  type BatchTargetColumn,
  type ComparisonRunData,
} from "../batch-evaluation-results.types.ts";
import { useResultsGrouping } from "../use-results-grouping.ts";
import { ComparisonLeaderboardChart } from "./comparison-leaderboard-chart.tsx";
import { WinRateChart } from "./win-rate-chart.tsx";

/** Metric types that can be displayed */
type MetricType =
  | "cost"
  | "latency"
  | `score_${string}`
  | `pass_${string}`
  | `comparison_${string}`
  | `leaderboard_${string}`;

/** Available metric definition */
type MetricDefinition = {
  id: MetricType;
  name: string;
  type: "cost" | "latency" | "score" | "passRate" | "comparison" | "leaderboard";
  evaluatorId?: string;
};

/**
 * Format cost value for display (max 4 decimals)
 */
const formatCost = (value: number): string => {
  if (value === 0) return "$0";
  if (value < 0.0001) return `$${value.toExponential(2)}`;
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
};

/**
 * Format latency value for display
 */
const formatLatency = (value: number): string => {
  if (value < 1) return `${value.toFixed(2)}ms`;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
};

/**
 * Calculate optimal Y-axis width based on formatted value lengths.
 * Uses approximate character width (7px per char) + padding.
 */
const calculateYAxisWidth = ({
  values,
  formatter,
  minWidth = 35,
  maxWidth = 80,
}: {
  values: number[];
  formatter: (value: number) => string;
  minWidth?: number;
  maxWidth?: number;
}): number => {
  if (values.length === 0) return minWidth;

  // Get the max formatted string length
  const maxLength = Math.max(...values.map((v) => formatter(v).length));

  // Approximate width: ~7px per character + some padding
  const calculatedWidth = maxLength * 7 + 12;

  return Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
};

// Axis label geometry is shared with WinRateChart so every chart on this page
// trims and slants the same variant names identically — see chartAxisLabels.ts.

export type XAxisOption = string;

type ComparisonChartsProps = {
  /** Comparison data from multiple runs */
  comparisonData: ComparisonRunData[];
  /** Whether charts are visible (controlled mode) */
  isVisible?: boolean;
  /** Callback when visibility changes (controlled mode) */
  onVisibilityChange?: (visible: boolean) => void;
  /** Whether to show charts by default (uncontrolled mode) */
  defaultVisible?: boolean;
  /** Map of prompt IDs to human-readable names */
  promptNames?: Record<string, string>;
  /** Which metrics are visible (controlled mode) */
  visibleMetrics?: Set<MetricType>;
  /** Callback when visible metrics change */
  onVisibleMetricsChange?: (metrics: Set<MetricType>) => void;
  /** Current X-axis option (controlled mode) */
  xAxisOption?: XAxisOption;
  /** Callback when X-axis option changes */
  onXAxisOptionChange?: (option: XAxisOption) => void;
  /** Callback to provide target color map when X-axis is "target" */
  onTargetColorsChange?: (colors: Record<string, string>) => void;
  /**
   * Comparison columns detected in the run. Rendered as extra chart cards inside the
   * same flex row as Cost / Latency so the win-rate chart shows up at parity size with
   * its siblings — not as a separate row below.
   */
  comparisonColumns?: BatchComparisonColumn[];
  /**
   * Rows for the primary run, needed by the Comparison leaderboard's
   * cost/duration tradeoff chart. Single-run only for v1 — not threaded
   * through per-run in `comparisonData`.
   */
  comparisonRows?: BatchResultRow[];
  showComparisonLeaderboard?: boolean;
  onOpenLeaderboard?: (input: {
    evaluatorId: string;
    column: BatchComparisonColumn;
    rows: BatchResultRow[];
    targetColors?: Record<string, string>;
    modelByTargetId?: Record<string, string | null>;
    judgeModel?: string | null;
  }) => void;
};

type EvaluatorMetrics = {
  scores: number[];
  passed: number;
  failed: number;
  total: number;
  name: string;
};

type RunMetricsResult = {
  totalCost: number;
  avgLatency: number;
  avgScores: Record<string, number>;
  passRates: Record<string, number>;
  evaluatorNames: Record<string, string>;
};

type TargetMetricsResult = {
  totalCost: number;
  avgLatency: number;
  avgScores: Record<string, number>;
  passRates: Record<string, number>;
  evaluatorNames: Record<string, string>;
};

const accumulateEvaluatorResults = ({
  evaluatorMetrics,
  targetOutput,
}: {
  evaluatorMetrics: Record<string, EvaluatorMetrics>;
  targetOutput: BatchEvaluationData["rows"][number]["targets"][string];
}): void => {
  for (const evalResult of targetOutput.evaluatorResults) {
    if (!evaluatorMetrics[evalResult.evaluatorId]) {
      evaluatorMetrics[evalResult.evaluatorId] = {
        scores: [],
        passed: 0,
        failed: 0,
        total: 0,
        name: evalResult.evaluatorName,
      };
    }

    const metrics = evaluatorMetrics[evalResult.evaluatorId]!;
    metrics.total++;

    if (evalResult.score !== null && evalResult.score !== undefined) {
      metrics.scores.push(evalResult.score);
    }

    if (evalResult.passed === true) {
      metrics.passed++;
    } else if (evalResult.passed === false) {
      metrics.failed++;
    }
  }
};

/**
 * Compute metrics for a single target within a run.
 * This is used when grouping by target to get per-target values
 * instead of global run averages.
 */
export const computeTargetMetrics = (
  rows: BatchEvaluationData["rows"],
  targetId: string,
): TargetMetricsResult => {
  let totalCost = 0;
  let totalDuration = 0;
  let durationCount = 0;
  const evaluatorMetrics: Record<string, EvaluatorMetrics> = {};

  for (const row of rows) {
    const targetOutput = row.targets[targetId];
    if (!targetOutput) continue;

    if (targetOutput.cost) totalCost += targetOutput.cost;
    if (targetOutput.duration) {
      totalDuration += targetOutput.duration;
      durationCount++;
    }

    accumulateEvaluatorResults({ evaluatorMetrics, targetOutput });
  }

  const avgLatency = durationCount > 0 ? totalDuration / durationCount : 0;
  const avgScores: Record<string, number> = {};
  const passRates: Record<string, number> = {};
  const evaluatorNames: Record<string, string> = {};

  for (const [evalId, metrics] of Object.entries(evaluatorMetrics)) {
    evaluatorNames[evalId] = metrics.name;

    if (metrics.scores.length > 0) {
      avgScores[evalId] = metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length;
    }

    if (metrics.passed + metrics.failed > 0) {
      passRates[evalId] = metrics.passed / (metrics.passed + metrics.failed);
    }
  }

  return {
    totalCost,
    avgLatency,
    avgScores,
    passRates,
    evaluatorNames,
  };
};

/**
 * Compute aggregate metrics for a single run (global averages)
 */
export const computeRunMetrics = (data: BatchEvaluationData): RunMetricsResult => {
  let totalCost = 0;
  let totalDuration = 0;
  let targetCount = 0;
  const evaluatorMetrics: Record<string, EvaluatorMetrics> = {};

  for (const row of data.rows) {
    for (const [, targetOutput] of Object.entries(row.targets)) {
      if (targetOutput.cost) totalCost += targetOutput.cost;
      if (targetOutput.duration) {
        totalDuration += targetOutput.duration;
        targetCount++;
      }

      accumulateEvaluatorResults({ evaluatorMetrics, targetOutput });
    }
  }

  const avgLatency = targetCount > 0 ? totalDuration / targetCount : 0;
  const avgScores: Record<string, number> = {};
  const passRates: Record<string, number> = {};
  const evaluatorNames: Record<string, string> = {};

  for (const [evalId, metrics] of Object.entries(evaluatorMetrics)) {
    evaluatorNames[evalId] = metrics.name;

    if (metrics.scores.length > 0) {
      avgScores[evalId] = metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length;
    }

    // Only compute pass rate if there are pass/fail results
    if (metrics.passed + metrics.failed > 0) {
      passRates[evalId] = metrics.passed / (metrics.passed + metrics.failed);
    }
  }

  return {
    totalCost,
    avgLatency,
    avgScores,
    passRates,
    evaluatorNames,
  };
};

/**
 * Which model each target ran on, and which model judged each comparison.
 */
const collectRunModels = (targetColumns: BatchTargetColumn[]) => {
  const modelByTargetId: Record<string, string | null> = {};
  const judgeModelByEvaluatorId: Record<string, string | null> = {};
  for (const target of targetColumns) {
    const model = target.model ?? null;
    modelByTargetId[target.id] = model;
    if (target.type !== "evaluator") continue;
    judgeModelByEvaluatorId[target.id] = model;
    if (target.evaluatorId) judgeModelByEvaluatorId[target.evaluatorId] = model;
  }
  return { modelByTargetId, judgeModelByEvaluatorId };
};

/** One metric entry per evaluator — its own score or pass-rate chart. */
const perEvaluatorMetrics = ({
  evaluators,
  type,
  idPrefix,
  label,
}: {
  evaluators: { id: string; name: string }[];
  type: MetricDefinition["type"];
  idPrefix: string;
  label: string;
}): MetricDefinition[] =>
  evaluators.map((ev) => ({
    id: `${idPrefix}_${ev.id}` as MetricType,
    name: `${ev.name} (${label})`,
    type,
    evaluatorId: ev.id,
  }));

/**
 * Win-rate and Bradley-Terry leaderboard entries for the comparison columns, so both
 * toggle through the same Metrics visibility system as their siblings (Cost / Latency /
 * Score / Pass Rate).
 */
const comparisonMetrics = ({
  columns,
  showLeaderboard,
}: {
  columns: BatchComparisonColumn[];
  showLeaderboard: boolean;
}): MetricDefinition[] => [
  ...columns.map((column) => ({
    id: `comparison_${column.evaluatorId}` as MetricType,
    name: `${column.name} (Win Rate)`,
    type: "comparison" as const,
    evaluatorId: column.evaluatorId,
  })),
  ...(showLeaderboard ? columns : [])
    .filter((column) => column.variants.length >= 3)
    .map((column) => ({
      id: `leaderboard_${column.evaluatorId}` as MetricType,
      name: `${column.name} (Leaderboard)`,
      type: "leaderboard" as const,
      evaluatorId: column.evaluatorId,
    })),
];

interface GroupMetricsAccumulator {
  displayName: string;
  costs: number[];
  latencies: number[];
  scores: Record<string, number[]>;
  passRates: Record<string, number[]>;
}

/** Folds one target's computed metrics into its group's running totals. */
function accumulateGroupMetrics(
  existing: GroupMetricsAccumulator,
  targetMetrics: TargetMetricsResult,
): void {
  existing.costs.push(targetMetrics.totalCost);
  if (targetMetrics.avgLatency > 0) {
    existing.latencies.push(targetMetrics.avgLatency);
  }
  for (const [evalId, score] of Object.entries(targetMetrics.avgScores)) {
    if (!existing.scores[evalId]) existing.scores[evalId] = [];
    existing.scores[evalId]!.push(score);
  }
  for (const [evalId, rate] of Object.entries(targetMetrics.passRates)) {
    if (!existing.passRates[evalId]) existing.passRates[evalId] = [];
    existing.passRates[evalId]!.push(rate);
  }
}

/** Averages each key's samples, naming the result `${prefix}_${key}`. */
function prefixedAverages(
  record: Record<string, number[]>,
  prefix: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(record)) {
    result[`${prefix}_${k}`] = v.reduce((a, b) => a + b, 0) / v.length;
  }
  return result;
}

/** A value the parent may control; without an `onChange` it is kept here. */
const useControllable = <T,>({
  value,
  onChange,
  initial,
}: {
  value: T | undefined;
  onChange: ((next: T) => void) | undefined;
  initial: T;
}): [T, (next: T) => void] => {
  const [internal, setInternal] = useState<T>(initial);
  return [value ?? internal, onChange ?? setInternal];
};

/**
 * "runs" for several runs; "target" for one run with several real (non-evaluator)
 * targets, since grouping evaluator-only columns by target says nothing.
 */
const defaultXAxisOf = (comparisonData: ComparisonRunData[]): XAxisOption => {
  if (comparisonData.length >= 2) return "runs";
  const targets = comparisonData[0]?.data?.targetColumns ?? [];
  const hasRealTarget = targets.some((t) => t.type !== "evaluator" && !t.id.startsWith("_eval_"));
  return targets.length >= 2 && hasRealTarget ? "target" : "runs";
};

type RunMetricsEntry = {
  runId: string;
  runName: ComparisonRunData["runName"];
  color: string;
  createdAt: number;
  metrics: RunMetricsResult;
  metadata: NonNullable<BatchTargetColumn["metadata"]>;
  targetColumns: BatchTargetColumn[];
  rows: BatchResultRow[];
};

/** Each loaded run's metrics, oldest first. */
const runMetricsOf = (comparisonData: ComparisonRunData[]): RunMetricsEntry[] =>
  comparisonData
    .flatMap((run) => (run.data ? [{ run, data: run.data }] : []))
    .map(({ run, data }) => ({
      runId: run.runId,
      runName: run.runName,
      color: run.color,
      createdAt: data.createdAt,
      metrics: computeRunMetrics(data),
      metadata: data.targetColumns[0]?.metadata ?? {},
      targetColumns: data.targetColumns,
      rows: data.rows,
    }))
    .toSorted((a, b) => a.createdAt - b.createdAt);

/** One color per distinct target id, in first-seen order. */
const targetColorsOf = (runMetrics: RunMetricsEntry[]): Record<string, string> => {
  const ids = [...new Set(runMetrics.flatMap((run) => run.targetColumns.map((t) => t.id)))];
  return Object.fromEntries(ids.map((id, index) => [id, RUN_COLORS[index % RUN_COLORS.length]!]));
};

type MetricGroup = {
  displayName: string;
  costs: number[];
  latencies: number[];
  scores: Record<string, number[]>;
  passRates: Record<string, number[]>;
};

const emptyGroup = (displayName: string): MetricGroup => ({
  displayName,
  costs: [],
  latencies: [],
  scores: {},
  passRates: {},
});

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / (values.length || 1);

const groupRow = (group: MetricGroup, color: string) => ({
  name: group.displayName,
  color,
  cost: mean(group.costs),
  latency: mean(group.latencies),
  ...prefixedAverages(group.scores, "score"),
  ...prefixedAverages(group.passRates, "pass"),
});

/** Per-target metrics folded into groups, keyed by `keyOf`; a target with no key is skipped. */
const groupedTargetMetrics = ({
  runMetrics,
  keyOf,
  displayNameOf,
}: {
  runMetrics: RunMetricsEntry[];
  keyOf: (target: BatchTargetColumn) => string | undefined;
  displayNameOf: (key: string, target: BatchTargetColumn) => string;
}): Map<string, MetricGroup> => {
  const groups = new Map<string, MetricGroup>();
  for (const run of runMetrics) {
    for (const target of run.targetColumns) {
      const key = keyOf(target);
      if (!key) continue;
      const group = groups.get(key) ?? emptyGroup(displayNameOf(key, target));
      // Per-target metrics, never the run's global ones.
      accumulateGroupMetrics(group, computeTargetMetrics(run.rows, target.id));
      groups.set(key, group);
    }
  }
  return groups;
};

/** A prompt target's group: its prompt id, with the version when it has one. */
const promptGroupKey = (target: BatchTargetColumn): string | undefined => {
  const promptId = target.promptId ?? target.metadata?.prompt_id;
  if (!promptId) return undefined;
  const version = target.promptId
    ? target.promptVersion
    : (target.promptVersion ?? target.metadata?.version);
  return version !== undefined && version !== null ? `${promptId}::v${version}` : String(promptId);
};

/** The group a target falls in for a property axis: model, prompt, or a metadata key. */
const propertyGroupKey = (
  target: BatchTargetColumn,
  xAxisOption: XAxisOption,
): string | undefined => {
  if (xAxisOption === "model") {
    if (target.model) return target.model;
    return target.metadata?.model ? String(target.metadata.model) : undefined;
  }
  if (xAxisOption === "prompt") return promptGroupKey(target);
  const value = target.metadata?.[xAxisOption];
  return value !== undefined ? String(value) : undefined;
};

/** The chart rows for the chosen x-axis: one per run, per target, or per property value. */
const chartRowsFor = ({
  runMetrics,
  xAxisOption,
  promptNames,
  comparisonEvaluatorIds,
  targetColors,
}: {
  runMetrics: RunMetricsEntry[];
  xAxisOption: XAxisOption;
  promptNames: Record<string, string>;
  comparisonEvaluatorIds: Set<string>;
  targetColors: Record<string, string>;
}) => {
  if (xAxisOption === "runs") {
    return runMetrics.map((run) => ({
      name: run.runName,
      color: run.color,
      cost: run.metrics.totalCost,
      latency: run.metrics.avgLatency,
      ...Object.fromEntries(
        Object.entries(run.metrics.avgScores).map(([k, v]) => [`score_${k}`, v]),
      ),
      ...Object.fromEntries(
        Object.entries(run.metrics.passRates).map(([k, v]) => [`pass_${k}`, v]),
      ),
    }));
  }
  if (xAxisOption === "target") {
    const groups = groupedTargetMetrics({
      runMetrics,
      keyOf: (target) => (comparisonEvaluatorIds.has(target.id) ? undefined : target.id),
      displayNameOf: (_key, target) => target.displayName ?? target.name,
    });
    return [...groups.entries()].map(([id, group], index) =>
      groupRow(group, targetColors[id] ?? RUN_COLORS[index % RUN_COLORS.length]!),
    );
  }
  const groups = groupedTargetMetrics({
    runMetrics,
    keyOf: (target) => propertyGroupKey(target, xAxisOption),
    displayNameOf: (key, target) => {
      if (xAxisOption !== "prompt") return key;
      const [promptId, versionPart] = key.split("::");
      const name = promptNames[promptId ?? ""] ?? target.name ?? promptId ?? key;
      return versionPart ? `${name} (${versionPart})` : name;
    },
  });
  return [...groups.values()].map((group, index) =>
    groupRow(group, RUN_COLORS[index % RUN_COLORS.length]!),
  );
};

/** Every evaluator some run reports `valuesOf` for, in first-seen order. */
const evaluatorsReporting = ({
  runMetrics,
  valuesOf,
  excluded,
}: {
  runMetrics: RunMetricsEntry[];
  valuesOf: (metrics: RunMetricsResult) => Record<string, number>;
  excluded: Set<string>;
}): { id: string; name: string }[] => {
  const byId = new Map<string, string>();
  for (const run of runMetrics) {
    for (const evalId of Object.keys(valuesOf(run.metrics))) {
      if (excluded.has(evalId) || byId.has(evalId)) continue;
      byId.set(evalId, run.metrics.evaluatorNames[evalId] ?? evalId);
    }
  }
  return [...byId.entries()].map(([id, name]) => ({ id, name }));
};

/**
 * The group-by choices: runs; targets from two up; model and prompt when any target
 * carries one (as a column or a metadata alias); then each generic metadata key.
 */
const xAxisOptionsOf = (
  runMetrics: RunMetricsEntry[],
  metadataKeys: readonly string[],
): { value: XAxisOption; label: string }[] => {
  const targets = runMetrics.flatMap((run) => run.targetColumns);
  const hasModel = targets.some((t) => !!t.model || (!!t.metadata && "model" in t.metadata));
  const hasPrompt = targets.some(
    (t) => !!t.promptId || (!!t.metadata && ("prompt_id" in t.metadata || "prompt" in t.metadata)),
  );
  return [
    { value: "runs", label: "Runs" },
    ...((runMetrics[0]?.targetColumns.length ?? 0) >= 2
      ? [{ value: "target", label: "Target" }]
      : []),
    ...(hasModel ? [{ value: "model", label: "Model" }] : []),
    ...(hasPrompt ? [{ value: "prompt", label: "Prompt" }] : []),
    ...metadataKeys.map((key) => ({ value: key, label: key })),
  ];
};

type ChartRow = { name: unknown; color?: string } & Record<string, unknown>;

/**
 * One bar chart in the row: a titled card, bars colored per row. `formatValue` formats
 * both the axis and the tooltip; `formatTooltip` alone leaves the axis as numbers.
 */
function MetricBarChart({
  testId,
  title,
  dataKey,
  barName,
  data,
  height,
  axis,
  formatAxisTick,
  yAxisWidth,
  yDomain,
  formatValue,
  formatTooltip,
}: {
  testId: string;
  title: string;
  dataKey: string;
  barName?: string;
  data: ChartRow[];
  height: number;
  axis: ReturnType<typeof axisLabelProps>;
  formatAxisTick: (value: unknown, index: number) => string;
  yAxisWidth: number;
  yDomain?: [number, number];
  formatValue?: (value: number) => string;
  formatTooltip?: (value: number) => string;
}) {
  const tooltipFormat = formatTooltip ?? formatValue;
  return (
    <Box
      minWidth="280px"
      width="280px"
      flexShrink={0}
      bg="bg.subtle"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      paddingBottom={1}
      data-testid={testId}
    >
      <Text fontSize="xs" fontWeight="medium" marginBottom={2} lineClamp={1} title={title}>
        {title}
      </Text>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ left: 10, right: 10 }}>
          <CartesianGrid
            horizontal={true}
            vertical={false}
            stroke="var(--chakra-colors-border)"
            strokeDasharray="0"
          />
          <XAxis
            dataKey="name"
            style={{ fontSize: "11px" }}
            axisLine={false}
            tickLine={false}
            angle={axis.angle}
            textAnchor={axis.textAnchor}
            height={axis.height}
            tickFormatter={formatAxisTick}
          />
          <YAxis
            style={{ fontSize: "11px" }}
            width={yAxisWidth}
            {...(yDomain ? { domain: yDomain } : {})}
            {...(formatValue ? { tickFormatter: (value: number) => formatValue(value) } : {})}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip />}
            {...(tooltipFormat ? { formatter: (value) => tooltipFormat(value as number) } : {})}
            cursor={{ fill: "currentColor", fillOpacity: 0.1 }}
          />
          <Bar dataKey={dataKey} {...(barName ? { name: barName } : {})}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color ?? RUN_COLORS[index % RUN_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

/**
 * A portaled dropdown anchored to its trigger: the rect is captured on open (not
 * tracked on scroll), and closing returns focus to the trigger.
 */
const useAnchoredDropdown = () => {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openDropdown = () => {
    setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };
  const closeDropdown = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return { open, setOpen, rect, buttonRef, openDropdown, closeDropdown };
};

/** The group-by selector. */
function GroupByDropdown({
  options,
  value,
  onSelect,
}: {
  options: { value: XAxisOption; label: string }[];
  value: XAxisOption;
  onSelect: (option: XAxisOption) => void;
}) {
  const { open, setOpen, rect, buttonRef, openDropdown, closeDropdown } = useAnchoredDropdown();
  return (
    <Box data-testid="xaxis-selector">
      <Button
        ref={buttonRef}
        size="xs"
        variant="outline"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        data-testid="group-by-button"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Group by: {options.find((o) => o.value === value)?.label ?? "Runs"}
      </Button>
      {open && rect && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={() => setOpen(false)}
            data-testid="group-by-backdrop"
          />
          <Box
            position="fixed"
            top={`${rect.bottom + 4}px`}
            left={`${rect.left}px`}
            bg="bg.panel"
            border="1px solid"
            borderColor="border"
            borderRadius="md"
            boxShadow="md"
            zIndex={1001}
            minWidth="150px"
            padding={2}
            style={{
              maxHeight: `calc(100vh - ${rect.bottom + 16}px)`,
              overflowY: "auto",
            }}
            data-testid="group-by-dropdown"
            role="menu"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeDropdown();
              }
            }}
          >
            <VStack align="stretch" gap={1}>
              {options.map((opt) => (
                <HStack
                  key={opt.value}
                  padding={1}
                  borderRadius="sm"
                  cursor="pointer"
                  bg={value === opt.value ? "blue.subtle" : "transparent"}
                  _hover={{
                    bg: value === opt.value ? "blue.muted" : "bg.subtle",
                  }}
                  onClick={() => {
                    onSelect(opt.value);
                    setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(opt.value);
                      setOpen(false);
                    }
                  }}
                  role="menuitem"
                  tabIndex={0}
                  data-testid={`xaxis-option-${opt.value}`}
                >
                  <Text
                    fontSize="sm"
                    fontWeight={value === opt.value ? "medium" : "normal"}
                    color={value === opt.value ? "blue.fg" : "inherit"}
                  >
                    {opt.label}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </Box>
        </Portal>
      )}
    </Box>
  );
}

/** The metrics selector: a checkbox per metric the run offers. */
function MetricsDropdown({
  availableMetrics,
  visibleMetrics,
  onToggle,
}: {
  availableMetrics: MetricDefinition[];
  visibleMetrics: Set<MetricType>;
  onToggle: (metric: MetricType) => void;
}) {
  const { open, setOpen, rect, buttonRef, openDropdown, closeDropdown } = useAnchoredDropdown();
  return (
    <Box>
      <Button
        ref={buttonRef}
        size="xs"
        variant="outline"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        data-testid="metrics-selector-button"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Metrics ({visibleMetrics.size}/{availableMetrics.length})
      </Button>
      {open && rect && (
        <Portal>
          <Box
            position="fixed"
            inset={0}
            zIndex={1000}
            onClick={() => setOpen(false)}
            data-testid="metrics-backdrop"
          />
          <Box
            position="fixed"
            top={`${rect.bottom + 4}px`}
            // Right-align to the trigger button so the dropdown
            // extends leftward, matching the pre-fix visual placement.
            left={`${rect.right}px`}
            transform="translateX(-100%)"
            bg="bg.panel"
            border="1px solid"
            borderColor="border"
            borderRadius="md"
            boxShadow="md"
            zIndex={1001}
            minWidth="200px"
            padding={2}
            style={{
              maxHeight: `calc(100vh - ${rect.bottom + 16}px)`,
              overflowY: "auto",
            }}
            data-testid="metrics-dropdown"
            role="menu"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeDropdown();
              }
            }}
          >
            <VStack align="stretch" gap={1}>
              {availableMetrics.map((metric) => (
                <HStack
                  key={metric.id}
                  padding={1}
                  borderRadius="sm"
                  cursor="pointer"
                  _hover={{ bg: "bg.subtle" }}
                  onClick={() => onToggle(metric.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onToggle(metric.id);
                    }
                  }}
                  role="menuitemcheckbox"
                  tabIndex={0}
                  aria-checked={visibleMetrics.has(metric.id)}
                >
                  <Box
                    width="16px"
                    height="16px"
                    minWidth="16px"
                    minHeight="16px"
                    flexShrink={0}
                    border="1px solid"
                    borderColor="border.emphasized"
                    borderRadius="sm"
                    bg={visibleMetrics.has(metric.id) ? "blue.500" : "transparent"}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    {visibleMetrics.has(metric.id) && (
                      <Text color="white" fontSize="xs" fontWeight="bold">
                        ✓
                      </Text>
                    )}
                  </Box>
                  <Text fontSize="sm" whiteSpace="nowrap">
                    {metric.name}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </Box>
        </Portal>
      )}
    </Box>
  );
}

const EMPTY_COLORS: Record<string, string> = {};

/** Reports target colors to the parent, only when their value actually changes. */
const useReportedTargetColors = ({
  onTargetColorsChange,
  colors,
}: {
  onTargetColorsChange: ((colors: Record<string, string>) => void) | undefined;
  colors: Record<string, string>;
}) => {
  const reportedRef = useRef<string>(JSON.stringify({}));
  useEffect(() => {
    if (!onTargetColorsChange) return;
    const json = JSON.stringify(colors);
    if (json === reportedRef.current) return;
    reportedRef.current = json;
    onTargetColorsChange(colors);
  }, [colors, onTargetColorsChange]);
};

/**
 * Which metrics show: the parent's set when it controls one, else cost and latency
 * plus every metric the run offers, including ones that appear later.
 */
const useVisibleMetrics = ({
  controlled,
  onChange,
  availableMetrics,
}: {
  controlled: Set<MetricType> | undefined;
  onChange: ((metrics: Set<MetricType>) => void) | undefined;
  availableMetrics: MetricDefinition[];
}) => {
  const [internal, setInternal] = useState<Set<MetricType>>(
    () => new Set(["cost", "latency"] as MetricType[]),
  );
  const seenRef = useRef<Set<MetricType>>(new Set());
  useEffect(() => {
    const unseen = availableMetrics.map((m) => m.id).filter((id) => !seenRef.current.has(id));
    if (unseen.length === 0) return;
    for (const id of unseen) seenRef.current.add(id);
    setInternal((current) => new Set([...current, ...unseen]));
  }, [availableMetrics]);

  const visibleMetrics = controlled ?? internal;
  const toggleMetric = (metricId: MetricType) => {
    const next = new Set(visibleMetrics);
    if (!next.delete(metricId)) next.add(metricId);
    (onChange ?? setInternal)(next);
  };
  return { visibleMetrics, toggleMetric };
};

export const ComparisonCharts = ({
  comparisonData,
  isVisible: controlledVisible,
  onVisibilityChange,
  defaultVisible,
  promptNames = {},
  visibleMetrics: controlledVisibleMetrics,
  onVisibleMetricsChange,
  xAxisOption: controlledXAxisOption,
  onXAxisOptionChange,
  onTargetColorsChange,
  comparisonColumns,
  comparisonRows,
  showComparisonLeaderboard = false,
  onOpenLeaderboard,
}: ComparisonChartsProps) => {
  // Comparison evaluators are excluded from candidate-oriented charts.
  const comparisonEvaluatorIds = useMemo(
    () => new Set((comparisonColumns ?? []).map((c) => c.evaluatorId)),
    [comparisonColumns],
  );

  /**
   * Which model each target ran on, and which model judged each comparison, as recorded
   * on the run itself.
   */
  const modelsFromRun = useMemo(
    () => collectRunModels(comparisonData[0]?.data?.targetColumns ?? []),
    [comparisonData],
  );
  // Determine default visibility based on target count
  // Shown by default from two targets up.
  const shouldShowByDefault =
    defaultVisible ?? (comparisonData[0]?.data?.targetColumns.length ?? 0) >= 2;

  const [isVisible] = useControllable({
    value: controlledVisible,
    onChange: onVisibilityChange,
    initial: shouldShowByDefault,
  });

  // Default X-axis: "runs" if multiple runs, "target" if single run with multiple real targets.
  // When all targets are evaluators (simple evaluations without a prompt/agent target),
  // each evaluator gets its own column but grouping by "target" is not useful — default to "runs".
  const defaultXAxis = useMemo(() => defaultXAxisOf(comparisonData), [comparisonData]);

  const [xAxisOption, setXAxisOption] = useControllable<XAxisOption>({
    value: controlledXAxisOption,
    onChange: onXAxisOptionChange,
    initial: defaultXAxis,
  });

  const applyDefaultXAxis = useEffectEvent((option: XAxisOption) => setXAxisOption(option));
  // Update X-axis when default changes (e.g., entering/exiting compare mode)
  useEffect(() => {
    applyDefaultXAxis(defaultXAxis);
  }, [defaultXAxis]);

  // Compute metrics for each run, sorted by creation time (oldest first)
  const runMetrics = useMemo(() => runMetricsOf(comparisonData), [comparisonData]);

  // Compute target colors (assign color per unique target ID)
  const targetColors = useMemo(() => targetColorsOf(runMetrics), [runMetrics]);

  useReportedTargetColors({
    onTargetColorsChange,
    // Target colors only mean something while the charts show and group by target.
    colors: isVisible && xAxisOption === "target" ? targetColors : EMPTY_COLORS,
  });

  // Build chart data based on X-axis selection
  const chartData = useMemo(
    () =>
      chartRowsFor({ runMetrics, xAxisOption, promptNames, comparisonEvaluatorIds, targetColors }),
    [runMetrics, xAxisOption, promptNames, comparisonEvaluatorIds, targetColors],
  );

  // Calculate dynamic Y-axis widths based on data
  const yAxisWidths = useMemo(() => {
    const costValues = chartData.map((d) => (d.cost as number) ?? 0);
    const latencyValues = chartData.map((d) => (d.latency as number) ?? 0);

    return {
      cost: calculateYAxisWidth({ values: costValues, formatter: formatCost }),
      latency: calculateYAxisWidth({ values: latencyValues, formatter: formatLatency }),
    };
  }, [chartData]);

  // Axis geometry for THIS component's charts (cost / latency / score), which
  // all share one x-axis of `chartData`.
  const axis = axisLabelProps(chartData.length);

  // Bar labels, precomputed for the whole row rather than trimmed per tick.
  const axisLabels = useMemo(
    () =>
      buildAxisLabels(
        chartData.map((d) => (typeof d.name === "string" ? d.name : JSON.stringify(d.name))),
        axis.maxLabelLength,
      ),
    [chartData, axis.maxLabelLength],
  );
  const formatAxisTick = (value: unknown, index: number): string =>
    axisLabels[index] ?? truncateLabel(String(value), axis.maxLabelLength);

  // Height is shared by every chart in the row, including the WinRateCharts
  // rendered alongside — and a win-rate chart's bar count (its variants, plus
  // Tie) is independent of `chartData`, which excludes comparison columns
  // entirely. Size from the busiest chart so the tallest axis still fits.
  const chartHeight = chartHeightFor(
    Math.max(chartData.length, ...(comparisonColumns ?? []).map((c) => c.variants.length + 1)),
  );

  // Get all evaluators with scores (for score chart)
  const scoreEvaluators = useMemo(
    () =>
      evaluatorsReporting({
        runMetrics,
        valuesOf: (metrics) => metrics.avgScores,
        excluded: comparisonEvaluatorIds,
      }),
    [runMetrics, comparisonEvaluatorIds],
  );
  const passRateEvaluators = useMemo(
    () =>
      evaluatorsReporting({
        runMetrics,
        valuesOf: (metrics) => metrics.passRates,
        excluded: new Set(),
      }),
    [runMetrics],
  );

  // Build available metrics list
  const availableMetrics: MetricDefinition[] = useMemo(
    () => [
      { id: "cost", name: "Total Cost", type: "cost" },
      { id: "latency", name: "Avg Latency", type: "latency" },
      ...perEvaluatorMetrics({
        evaluators: scoreEvaluators,
        type: "score",
        idPrefix: "score",
        label: "Score",
      }),
      ...perEvaluatorMetrics({
        evaluators: passRateEvaluators,
        type: "passRate",
        idPrefix: "pass",
        label: "Pass Rate",
      }),
      ...comparisonMetrics({
        columns: comparisonColumns ?? [],
        showLeaderboard: showComparisonLeaderboard,
      }),
    ],
    [scoreEvaluators, passRateEvaluators, comparisonColumns, showComparisonLeaderboard],
  );

  const { visibleMetrics, toggleMetric } = useVisibleMetrics({
    controlled: controlledVisibleMetrics,
    onChange: onVisibleMetricsChange,
    availableMetrics,
  });

  // Generic metadata keys come from the shared hook so the chart and
  // ComparisonTable use identical discovery (and adding a third surface
  // later only needs to import the same hook). The hook excludes the
  // reserved keys (model / prompt_id / prompt / version), which we
  // surface here under their dedicated labels.
  const { availableKeys: targetMetadataKeys } = useResultsGrouping({
    source: "target-metadata",
    comparisonData,
  });

  // Get available X-axis options from target properties and metadata
  const xAxisOptions = useMemo(
    () => xAxisOptionsOf(runMetrics, targetMetadataKeys),
    [runMetrics, targetMetadataKeys],
  );

  // Show charts if:
  // 1. Multiple runs (compare mode)
  // 2. Single run with multiple targets
  const targetCount = runMetrics[0]?.targetColumns?.length ?? 0;
  const canShowCharts = comparisonData.length >= 2 || targetCount >= 2;

  if (!canShowCharts) {
    return null;
  }

  return (
    isVisible && (
      <VStack width="100%" align="stretch" gap={4} marginBottom={4} flexShrink={0}>
        <VStack width="100%" align="stretch" gap={2}>
          {/* Controls row: Group by selector + Metrics selector */}
          <HStack wrap="wrap" gap={2} paddingX={2}>
            {/* Group by dropdown */}
            {xAxisOptions.length > 0 && (
              <GroupByDropdown
                options={xAxisOptions}
                value={xAxisOption}
                onSelect={setXAxisOption}
              />
            )}

            <MetricsDropdown
              availableMetrics={availableMetrics}
              visibleMetrics={visibleMetrics}
              onToggle={toggleMetric}
            />
          </HStack>

          {/* Charts in horizontal scroll container */}
          <HStack
            overflowX="auto"
            gap={4}
            align="stretch"
            paddingX={2}
            paddingBottom={2}
            data-testid="charts-container"
          >
            {visibleMetrics.has("cost") && (
              <MetricBarChart
                testId="chart-cost"
                title="Total Cost"
                dataKey="cost"
                barName="Cost"
                data={chartData}
                height={chartHeight}
                axis={axis}
                formatAxisTick={formatAxisTick}
                yAxisWidth={yAxisWidths.cost}
                formatValue={formatCost}
              />
            )}

            {visibleMetrics.has("latency") && (
              <MetricBarChart
                testId="chart-latency"
                title="Avg Latency"
                dataKey="latency"
                barName="Latency"
                data={chartData}
                height={chartHeight}
                axis={axis}
                formatAxisTick={formatAxisTick}
                yAxisWidth={yAxisWidths.latency}
                formatValue={formatLatency}
              />
            )}

            {scoreEvaluators.map(
              (ev) =>
                visibleMetrics.has(`score_${ev.id}` as MetricType) && (
                  <MetricBarChart
                    key={`score-${ev.id}`}
                    testId={`chart-score-${ev.id}`}
                    title={`${ev.name} (Score)`}
                    dataKey={`score_${ev.id}`}
                    data={chartData}
                    height={chartHeight}
                    axis={axis}
                    formatAxisTick={formatAxisTick}
                    yAxisWidth={40}
                    yDomain={[0, 1]}
                    formatTooltip={(value) => value.toFixed(2)}
                  />
                ),
            )}
            {/* Win-rate charts — one per detected comparison
                evaluator. Rendered inside the same flex row as Cost / Latency
                so they read as siblings, not a separate section below.
                Gated on `visibleMetrics` so users can hide it via the
                Metrics dropdown alongside the sibling metric types. */}
            {comparisonColumns?.map(
              (column) =>
                visibleMetrics.has(`comparison_${column.evaluatorId}` as MetricType) && (
                  <WinRateChart
                    key={`comparison-${column.evaluatorId}`}
                    column={column}
                    chartHeight={chartHeight}
                    targetColors={targetColors}
                  />
                ),
            )}

            {/* Bradley-Terry leaderboard chart (#5103) — a sibling of
                WinRateChart, gated the same way through the Metrics
                dropdown. The rollout flag is re-checked here rather than
                left to visibleMetrics: a metric id already switched on from
                a previous session would otherwise keep rendering the chart
                after the flag was turned back off. */}
            {showComparisonLeaderboard &&
              comparisonColumns?.map(
                (column) =>
                  visibleMetrics.has(`leaderboard_${column.evaluatorId}` as MetricType) && (
                    <ComparisonLeaderboardChart
                      key={`leaderboard-${column.evaluatorId}`}
                      column={column}
                      rows={comparisonRows ?? []}
                      chartHeight={chartHeight}
                      targetColors={targetColors}
                      modelByTargetId={modelsFromRun.modelByTargetId}
                      judgeModel={modelsFromRun.judgeModelByEvaluatorId[column.evaluatorId] ?? null}
                      onExpand={onOpenLeaderboard}
                    />
                  ),
              )}

            {passRateEvaluators.map(
              (ev) =>
                visibleMetrics.has(`pass_${ev.id}` as MetricType) && (
                  <MetricBarChart
                    key={`pass-${ev.id}`}
                    testId={`chart-pass-${ev.id}`}
                    title={`${ev.name} (Pass Rate)`}
                    dataKey={`pass_${ev.id}`}
                    data={chartData}
                    height={chartHeight}
                    axis={axis}
                    formatAxisTick={formatAxisTick}
                    yAxisWidth={40}
                    yDomain={[0, 1]}
                    formatValue={(value) => `${Math.round(value * 100)}%`}
                  />
                ),
            )}
          </HStack>
        </VStack>
      </VStack>
    )
  );
};
