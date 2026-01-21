/**
 * ComparisonCharts - Bar charts for comparing metrics across runs
 *
 * Displays cost, latency, and per-evaluator metrics.
 * Each evaluator gets its own chart (score or pass rate).
 * Supports different X-axis groupings (by run, target, model, prompt, custom metadata).
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
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

import type { BatchEvaluationData, ComparisonRunData } from "./types";
import { RUN_COLORS } from "./useMultiRunData";

/** Metric types that can be displayed */
type MetricType = "cost" | "latency" | `score_${string}` | `pass_${string}`;

/** Available metric definition */
type MetricDefinition = {
  id: MetricType;
  name: string;
  type: "cost" | "latency" | "score" | "passRate";
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
const calculateYAxisWidth = (
  values: number[],
  formatter: (value: number) => string,
  minWidth = 35,
  maxWidth = 80,
): number => {
  if (values.length === 0) return minWidth;

  // Get the max formatted string length
  const maxLength = Math.max(...values.map((v) => formatter(v).length));

  // Approximate width: ~7px per character + some padding
  const calculatedWidth = maxLength * 7 + 12;

  return Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
};

/** Threshold for rotating X-axis labels (item count) */
const ROTATE_LABELS_THRESHOLD = 3;

/** Max label length before truncating (normal) */
const MAX_LABEL_LENGTH = 14;
/** Max label length when rotated */
const MAX_LABEL_LENGTH_ROTATED = 10;

/** Truncate a label and add ellipsis if too long */
const truncateLabel = (label: string, maxLength = MAX_LABEL_LENGTH): string => {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + "…";
};

/** Chart height when labels are rotated (needs more space) */
const CHART_HEIGHT_ROTATED = 190;
const CHART_HEIGHT_NORMAL = 150;

export type XAxisOption = "runs" | "target" | "model" | "prompt" | string;

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
  }

  const avgLatency = durationCount > 0 ? totalDuration / durationCount : 0;
  const avgScores: Record<string, number> = {};
  const passRates: Record<string, number> = {};
  const evaluatorNames: Record<string, string> = {};

  for (const [evalId, metrics] of Object.entries(evaluatorMetrics)) {
    evaluatorNames[evalId] = metrics.name;

    if (metrics.scores.length > 0) {
      avgScores[evalId] =
        metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length;
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
export const computeRunMetrics = (
  data: BatchEvaluationData,
): RunMetricsResult => {
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
    }
  }

  const avgLatency = targetCount > 0 ? totalDuration / targetCount : 0;
  const avgScores: Record<string, number> = {};
  const passRates: Record<string, number> = {};
  const evaluatorNames: Record<string, string> = {};

  for (const [evalId, metrics] of Object.entries(evaluatorMetrics)) {
    evaluatorNames[evalId] = metrics.name;

    if (metrics.scores.length > 0) {
      avgScores[evalId] =
        metrics.scores.reduce((a, b) => a + b, 0) / metrics.scores.length;
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
}: ComparisonChartsProps) => {
  // Determine default visibility based on target count
  const shouldShowByDefault = useMemo(() => {
    if (defaultVisible !== undefined) return defaultVisible;
    // Show by default if there are 2+ targets
    const targetCount = comparisonData[0]?.data?.targetColumns.length ?? 0;
    return targetCount >= 2;
  }, [comparisonData, defaultVisible]);

  const [internalVisible, setInternalVisible] = useState(shouldShowByDefault);
  const isVisible = controlledVisible ?? internalVisible;
  const _setIsVisible = (visible: boolean) => {
    if (onVisibilityChange) {
      onVisibilityChange(visible);
    } else {
      setInternalVisible(visible);
    }
  };

  // Default X-axis: "runs" if multiple runs, "target" if single run with multiple targets
  const defaultXAxis = useMemo((): XAxisOption => {
    if (comparisonData.length >= 2) return "runs";
    const targetCount = comparisonData[0]?.data?.targetColumns.length ?? 0;
    if (targetCount >= 2) return "target";
    return "runs";
  }, [comparisonData]);

  const [internalXAxisOption, setInternalXAxisOption] =
    useState<XAxisOption>(defaultXAxis);
  const xAxisOption = controlledXAxisOption ?? internalXAxisOption;
  const setXAxisOption = (option: XAxisOption) => {
    if (onXAxisOptionChange) {
      onXAxisOptionChange(option);
    } else {
      setInternalXAxisOption(option);
    }
  };

  // Update X-axis when default changes (e.g., entering/exiting compare mode)
  useEffect(() => {
    setXAxisOption(defaultXAxis);
  }, [defaultXAxis]);

  // Metrics selector state
  const [internalVisibleMetrics, setInternalVisibleMetrics] = useState<
    Set<MetricType>
  >(() => new Set(["cost", "latency"] as MetricType[]));
  const [metricsDropdownOpen, setMetricsDropdownOpen] = useState(false);
  const [groupByDropdownOpen, setGroupByDropdownOpen] = useState(false);

  const visibleMetrics = controlledVisibleMetrics ?? internalVisibleMetrics;
  const setVisibleMetrics = (metrics: Set<MetricType>) => {
    if (onVisibleMetricsChange) {
      onVisibleMetricsChange(metrics);
    } else {
      setInternalVisibleMetrics(metrics);
    }
  };

  const toggleMetric = (metricId: MetricType) => {
    const newSet = new Set(visibleMetrics);
    if (newSet.has(metricId)) {
      newSet.delete(metricId);
    } else {
      newSet.add(metricId);
    }
    setVisibleMetrics(newSet);
  };

  // Compute metrics for each run, sorted by creation time (oldest first)
  const runMetrics = useMemo(() => {
    return comparisonData
      .filter((run) => run.data !== null)
      .map((run) => ({
        runId: run.runId,
        runName: run.runName,
        color: run.color,
        createdAt: run.data!.createdAt,
        metrics: computeRunMetrics(run.data!),
        metadata: run.data!.targetColumns[0]?.metadata ?? {},
        targetColumns: run.data!.targetColumns,
        rows: run.data!.rows,
      }))
      .sort((a, b) => a.createdAt - b.createdAt); // Sort by creation time, oldest first
  }, [comparisonData]);

  // Compute target colors (assign color per unique target ID)
  const targetColors = useMemo(() => {
    const colors: Record<string, string> = {};
    const seenIds = new Set<string>();
    let colorIndex = 0;

    for (const run of runMetrics) {
      for (const targetCol of run.targetColumns) {
        if (!seenIds.has(targetCol.id)) {
          seenIds.add(targetCol.id);
          colors[targetCol.id] = RUN_COLORS[colorIndex % RUN_COLORS.length]!;
          colorIndex++;
        }
      }
    }

    return colors;
  }, [runMetrics]);

  // Report target colors when X-axis is "target" AND charts are visible
  // Only call callback when the effective value changes
  const prevTargetColorsRef = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    if (!onTargetColorsChange) return;

    // Only show target colors when charts are visible and X-axis is "target"
    const newColors = isVisible && xAxisOption === "target" ? targetColors : {};
    const prevColors = prevTargetColorsRef.current;

    // Compare by JSON to detect actual changes
    const prevJson = JSON.stringify(prevColors ?? {});
    const newJson = JSON.stringify(newColors);

    if (prevJson !== newJson) {
      prevTargetColorsRef.current = newColors;
      onTargetColorsChange(newColors);
    }
  }, [isVisible, xAxisOption, targetColors, onTargetColorsChange]);

  // Build chart data based on X-axis selection
  const chartData = useMemo(() => {
    if (xAxisOption === "runs") {
      return runMetrics.map((run) => ({
        name: run.runName,
        color: run.color,
        cost: run.metrics.totalCost,
        latency: run.metrics.avgLatency,
        ...Object.fromEntries(
          Object.entries(run.metrics.avgScores).map(([k, v]) => [
            `score_${k}`,
            v,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(run.metrics.passRates).map(([k, v]) => [
            `pass_${k}`,
            v,
          ]),
        ),
      }));
    }

    // Handle "target" X-axis option - group by target ID (unique), display name
    // IMPORTANT: We compute per-target metrics, NOT global run metrics!
    if (xAxisOption === "target") {
      const targetGroups = new Map<
        string,
        {
          name: string;
          costs: number[];
          latencies: number[];
          scores: Record<string, number[]>;
          passRates: Record<string, number[]>;
        }
      >();

      for (const run of runMetrics) {
        for (const targetCol of run.targetColumns) {
          // Compute metrics for THIS target only (not global run metrics!)
          const targetMetrics = computeTargetMetrics(run.rows, targetCol.id);

          // Use ID as key for uniqueness
          const existing = targetGroups.get(targetCol.id) ?? {
            name: targetCol.name,
            costs: [],
            latencies: [],
            scores: {},
            passRates: {},
          };

          // Add this target's metrics
          existing.costs.push(targetMetrics.totalCost);
          if (targetMetrics.avgLatency > 0) {
            existing.latencies.push(targetMetrics.avgLatency);
          }

          // Aggregate per-target evaluator metrics (NOT global run.metrics!)
          for (const [evalId, score] of Object.entries(
            targetMetrics.avgScores,
          )) {
            if (!existing.scores[evalId]) existing.scores[evalId] = [];
            existing.scores[evalId]!.push(score);
          }
          for (const [evalId, rate] of Object.entries(
            targetMetrics.passRates,
          )) {
            if (!existing.passRates[evalId]) existing.passRates[evalId] = [];
            existing.passRates[evalId]!.push(rate);
          }

          targetGroups.set(targetCol.id, existing);
        }
      }

      // Use the stored name for display, include color from targetColors
      return Array.from(targetGroups.entries()).map(([id, data]) => ({
        name: data.name,
        color: targetColors[id],
        cost: data.costs.reduce((a, b) => a + b, 0) / (data.costs.length || 1),
        latency:
          data.latencies.reduce((a, b) => a + b, 0) /
          (data.latencies.length || 1),
        ...Object.fromEntries(
          Object.entries(data.scores).map(([k, v]) => [
            `score_${k}`,
            v.reduce((a, b) => a + b, 0) / v.length,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(data.passRates).map(([k, v]) => [
            `pass_${k}`,
            v.reduce((a, b) => a + b, 0) / v.length,
          ]),
        ),
      }));
    }

    // Group by target property or metadata value (model, prompt, custom metadata)
    // This works per-target (like "target" grouping), grouping by the property value
    // E.g., for "model": all targets with model="openai/gpt-4" are grouped together
    const propertyGroups = new Map<
      string,
      {
        displayName: string;
        costs: number[];
        latencies: number[];
        scores: Record<string, number[]>;
        passRates: Record<string, number[]>;
      }
    >();

    // Helper to get the grouping key from a target
    const getGroupKey = (
      targetCol: (typeof runMetrics)[0]["targetColumns"][0],
    ): string | undefined => {
      // Check top-level model property first
      if (xAxisOption === "model") {
        if (targetCol.model) return targetCol.model;
        if (targetCol.metadata?.model) return String(targetCol.metadata.model);
        return undefined;
      }

      // For prompt, combine promptId and version
      if (xAxisOption === "prompt") {
        if (!targetCol.promptId) {
          // Check metadata for prompt_id
          if (targetCol.metadata?.prompt_id) {
            const version =
              targetCol.promptVersion ?? targetCol.metadata?.version;
            return version !== undefined && version !== null
              ? `${targetCol.metadata.prompt_id}::v${version}`
              : String(targetCol.metadata.prompt_id);
          }
          return undefined;
        }
        const version = targetCol.promptVersion;
        return version !== undefined && version !== null
          ? `${targetCol.promptId}::v${version}`
          : targetCol.promptId;
      }

      // For custom metadata keys
      if (targetCol.metadata?.[xAxisOption] !== undefined) {
        return String(targetCol.metadata[xAxisOption]);
      }

      return undefined;
    };

    // Helper to get display name for a group key
    const getDisplayName = (
      key: string,
      targetCol: (typeof runMetrics)[0]["targetColumns"][0],
    ): string => {
      if (xAxisOption === "prompt") {
        // Key is in format "promptId::vN" or just "promptId"
        const [promptId, versionPart] = key.split("::");
        const resolvedPromptName =
          promptNames[promptId ?? ""] ?? targetCol.name ?? promptId ?? key;
        return versionPart
          ? `${resolvedPromptName} (${versionPart})`
          : resolvedPromptName;
      }
      return key;
    };

    for (const run of runMetrics) {
      for (const targetCol of run.targetColumns) {
        const key = getGroupKey(targetCol);
        if (!key) continue;

        // Compute metrics for THIS target only
        const targetMetrics = computeTargetMetrics(run.rows, targetCol.id);

        const existing = propertyGroups.get(key) ?? {
          displayName: getDisplayName(key, targetCol),
          costs: [],
          latencies: [],
          scores: {},
          passRates: {},
        };

        // Add this target's metrics
        existing.costs.push(targetMetrics.totalCost);
        if (targetMetrics.avgLatency > 0) {
          existing.latencies.push(targetMetrics.avgLatency);
        }

        // Aggregate evaluator metrics
        for (const [evalId, score] of Object.entries(targetMetrics.avgScores)) {
          if (!existing.scores[evalId]) existing.scores[evalId] = [];
          existing.scores[evalId]!.push(score);
        }
        for (const [evalId, rate] of Object.entries(targetMetrics.passRates)) {
          if (!existing.passRates[evalId]) existing.passRates[evalId] = [];
          existing.passRates[evalId]!.push(rate);
        }

        propertyGroups.set(key, existing);
      }
    }

    return Array.from(propertyGroups.entries()).map(([_key, data]) => ({
      name: data.displayName,
      cost: data.costs.reduce((a, b) => a + b, 0) / (data.costs.length || 1),
      latency:
        data.latencies.reduce((a, b) => a + b, 0) /
        (data.latencies.length || 1),
      ...Object.fromEntries(
        Object.entries(data.scores).map(([k, v]) => [
          `score_${k}`,
          v.reduce((a, b) => a + b, 0) / v.length,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(data.passRates).map(([k, v]) => [
          `pass_${k}`,
          v.reduce((a, b) => a + b, 0) / v.length,
        ]),
      ),
    }));
  }, [runMetrics, xAxisOption, promptNames]);

  // Calculate dynamic Y-axis widths based on data
  const yAxisWidths = useMemo(() => {
    const costValues = chartData.map((d) => (d.cost as number) ?? 0);
    const latencyValues = chartData.map((d) => (d.latency as number) ?? 0);

    return {
      cost: calculateYAxisWidth(costValues, formatCost),
      latency: calculateYAxisWidth(latencyValues, formatLatency),
    };
  }, [chartData]);

  // Determine if X-axis labels should be rotated (3+ items)
  const shouldRotateLabels = chartData.length >= ROTATE_LABELS_THRESHOLD;
  const chartHeight = shouldRotateLabels
    ? CHART_HEIGHT_ROTATED
    : CHART_HEIGHT_NORMAL;

  // Get all evaluators with scores (for score chart)
  const scoreEvaluators = useMemo(() => {
    const evaluators: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const run of runMetrics) {
      for (const evalId of Object.keys(run.metrics.avgScores)) {
        if (!seen.has(evalId)) {
          seen.add(evalId);
          evaluators.push({
            id: evalId,
            name: run.metrics.evaluatorNames[evalId] ?? evalId,
          });
        }
      }
    }
    return evaluators;
  }, [runMetrics]);

  // Get all evaluators with pass rates (for pass rate chart)
  const passRateEvaluators = useMemo(() => {
    const evaluators: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const run of runMetrics) {
      for (const evalId of Object.keys(run.metrics.passRates)) {
        if (!seen.has(evalId)) {
          seen.add(evalId);
          evaluators.push({
            id: evalId,
            name: run.metrics.evaluatorNames[evalId] ?? evalId,
          });
        }
      }
    }
    return evaluators;
  }, [runMetrics]);

  // Build available metrics list
  const availableMetrics: MetricDefinition[] = useMemo(() => {
    const metrics: MetricDefinition[] = [
      { id: "cost", name: "Total Cost", type: "cost" },
      { id: "latency", name: "Avg Latency", type: "latency" },
    ];

    // Add per-evaluator score metrics
    for (const ev of scoreEvaluators) {
      metrics.push({
        id: `score_${ev.id}` as MetricType,
        name: `${ev.name} (Score)`,
        type: "score",
        evaluatorId: ev.id,
      });
    }

    // Add per-evaluator pass rate metrics
    for (const ev of passRateEvaluators) {
      metrics.push({
        id: `pass_${ev.id}` as MetricType,
        name: `${ev.name} (Pass Rate)`,
        type: "passRate",
        evaluatorId: ev.id,
      });
    }

    return metrics;
  }, [scoreEvaluators, passRateEvaluators]);

  // Initialize visible metrics to include all available metrics on first load
  useEffect(() => {
    if (availableMetrics.length > 0 && internalVisibleMetrics.size <= 2) {
      const allMetricIds = new Set(availableMetrics.map((m) => m.id));
      setInternalVisibleMetrics(allMetricIds);
    }
  }, [availableMetrics]);

  // Get available X-axis options from target properties and metadata
  const xAxisOptions = useMemo(() => {
    const options: { value: XAxisOption; label: string }[] = [
      { value: "runs", label: "Runs" },
    ];

    // Add "Target" option if there are 2+ targets
    const targetCount = runMetrics[0]?.targetColumns?.length ?? 0;
    if (targetCount >= 2) {
      options.push({ value: "target", label: "Target" });
    }

    // Track which properties/metadata keys exist across all targets
    let hasModel = false;
    let hasPrompt = false; // Prompt option combines promptId + version
    const metadataKeys = new Set<string>();

    for (const run of runMetrics) {
      for (const targetCol of run.targetColumns) {
        // Check top-level target properties
        if (targetCol.model) hasModel = true;
        if (targetCol.promptId) hasPrompt = true;

        // Check metadata object
        if (targetCol.metadata) {
          for (const key of Object.keys(targetCol.metadata)) {
            if (key === "model") hasModel = true;
            else if (key === "prompt_id" || key === "prompt") hasPrompt = true;
            // Skip "version" as it's combined with prompt
            else if (key !== "version") metadataKeys.add(key);
          }
        }
      }
    }

    // Add common keys with nice labels
    if (hasModel) {
      options.push({ value: "model", label: "Model" });
    }
    if (hasPrompt) {
      options.push({ value: "prompt", label: "Prompt" });
    }

    // Add remaining metadata keys
    for (const key of metadataKeys) {
      options.push({ value: key, label: key });
    }

    return options;
  }, [runMetrics]);

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
      <VStack
        width="100%"
        align="stretch"
        gap={4}
        marginBottom={4}
        flexShrink={0}
      >
        <VStack width="100%" align="stretch" gap={2}>
          {/* Controls row: Group by selector + Metrics selector */}
          <HStack wrap="wrap" gap={2} paddingX={2}>
            {/* Group by dropdown */}
            {xAxisOptions.length > 0 && (
              <Box position="relative" data-testid="xaxis-selector">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setGroupByDropdownOpen(!groupByDropdownOpen)}
                  data-testid="group-by-button"
                >
                  Group by:{" "}
                  {xAxisOptions.find((o) => o.value === xAxisOption)?.label ??
                    "Runs"}
                </Button>
                {groupByDropdownOpen && (
                  <Box
                    position="absolute"
                    top="100%"
                    left={0}
                    marginTop={1}
                    bg="white"
                    border="1px solid"
                    borderColor="border"
                    borderRadius="md"
                    boxShadow="md"
                    zIndex={1000}
                    minWidth="150px"
                    padding={2}
                    data-testid="group-by-dropdown"
                  >
                    <VStack align="stretch" gap={1}>
                      {xAxisOptions.map((opt) => (
                        <HStack
                          key={opt.value}
                          padding={1}
                          borderRadius="sm"
                          cursor="pointer"
                          bg={
                            xAxisOption === opt.value
                              ? "blue.50"
                              : "transparent"
                          }
                          _hover={{
                            bg:
                              xAxisOption === opt.value
                                ? "blue.100"
                                : "gray.50",
                          }}
                          onClick={() => {
                            setXAxisOption(opt.value);
                            setGroupByDropdownOpen(false);
                          }}
                          data-testid={`xaxis-option-${opt.value}`}
                        >
                          <Text
                            fontSize="sm"
                            fontWeight={
                              xAxisOption === opt.value ? "medium" : "normal"
                            }
                            color={
                              xAxisOption === opt.value ? "blue.600" : "inherit"
                            }
                          >
                            {opt.label}
                          </Text>
                        </HStack>
                      ))}
                    </VStack>
                  </Box>
                )}
              </Box>
            )}

            {/* Metrics selector dropdown */}
            <Box position="relative">
              <Button
                size="xs"
                variant="outline"
                onClick={() => setMetricsDropdownOpen(!metricsDropdownOpen)}
                data-testid="metrics-selector-button"
              >
                Metrics ({visibleMetrics.size}/{availableMetrics.length})
              </Button>
              {metricsDropdownOpen && (
                <Box
                  position="absolute"
                  top="100%"
                  right={0}
                  marginTop={1}
                  bg="white"
                  border="1px solid"
                  borderColor="border"
                  borderRadius="md"
                  boxShadow="md"
                  zIndex={1000}
                  minWidth="200px"
                  padding={2}
                  data-testid="metrics-dropdown"
                >
                  <VStack align="stretch" gap={1}>
                    {availableMetrics.map((metric) => (
                      <HStack
                        key={metric.id}
                        padding={1}
                        borderRadius="sm"
                        cursor="pointer"
                        _hover={{ bg: "gray.50" }}
                        onClick={() => toggleMetric(metric.id)}
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
                          bg={
                            visibleMetrics.has(metric.id)
                              ? "blue.500"
                              : "transparent"
                          }
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
              )}
            </Box>
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
            {/* Cost chart */}
            {visibleMetrics.has("cost") && (
              <Box
                minWidth="280px"
                width="280px"
                flexShrink={0}
                bg="bg.subtle"
                borderRadius="md"
                padding={3}
                paddingBottom={1}
                data-testid="chart-cost"
              >
                <Text
                  fontSize="xs"
                  fontWeight="medium"
                  marginBottom={2}
                  lineClamp={1}
                  title="Total Cost"
                >
                  Total Cost
                </Text>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
                    <CartesianGrid
                      horizontal={true}
                      vertical={false}
                      stroke="#EDF2F7"
                      strokeDasharray="0"
                    />
                    <XAxis
                      dataKey="name"
                      style={{ fontSize: "11px" }}
                      axisLine={false}
                      tickLine={false}
                      angle={shouldRotateLabels ? -45 : 0}
                      textAnchor={shouldRotateLabels ? "end" : "middle"}
                      height={shouldRotateLabels ? 60 : 25}
                      tickFormatter={(value) =>
                        truncateLabel(
                          String(value),
                          shouldRotateLabels
                            ? MAX_LABEL_LENGTH_ROTATED
                            : MAX_LABEL_LENGTH,
                        )
                      }
                    />
                    <YAxis
                      style={{ fontSize: "11px" }}
                      width={yAxisWidths.cost}
                      tickFormatter={(value) => formatCost(value as number)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => formatCost(value as number)}
                    />
                    <Bar dataKey="cost" name="Cost">
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            (entry as any).color ??
                            RUN_COLORS[index % RUN_COLORS.length]
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}

            {/* Latency chart */}
            {visibleMetrics.has("latency") && (
              <Box
                minWidth="280px"
                width="280px"
                flexShrink={0}
                bg="bg.subtle"
                borderRadius="md"
                padding={3}
                paddingBottom={1}
                data-testid="chart-latency"
              >
                <Text
                  fontSize="xs"
                  fontWeight="medium"
                  marginBottom={2}
                  lineClamp={1}
                  title="Avg Latency"
                >
                  Avg Latency
                </Text>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
                    <CartesianGrid
                      horizontal={true}
                      vertical={false}
                      stroke="#EDF2F7"
                      strokeDasharray="0"
                    />
                    <XAxis
                      dataKey="name"
                      style={{ fontSize: "11px" }}
                      axisLine={false}
                      tickLine={false}
                      angle={shouldRotateLabels ? -45 : 0}
                      textAnchor={shouldRotateLabels ? "end" : "middle"}
                      height={shouldRotateLabels ? 60 : 25}
                      tickFormatter={(value) =>
                        truncateLabel(
                          String(value),
                          shouldRotateLabels
                            ? MAX_LABEL_LENGTH_ROTATED
                            : MAX_LABEL_LENGTH,
                        )
                      }
                    />
                    <YAxis
                      style={{ fontSize: "11px" }}
                      width={yAxisWidths.latency}
                      tickFormatter={(value) => formatLatency(value as number)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value) => formatLatency(value as number)}
                    />
                    <Bar dataKey="latency" name="Latency">
                      {chartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            (entry as any).color ??
                            RUN_COLORS[index % RUN_COLORS.length]
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}

            {/* Per-evaluator score charts */}
            {scoreEvaluators.map(
              (ev) =>
                visibleMetrics.has(`score_${ev.id}` as MetricType) && (
                  <Box
                    key={`score-${ev.id}`}
                    minWidth="280px"
                    width="280px"
                    flexShrink={0}
                    bg="bg.subtle"
                    borderRadius="md"
                    padding={3}
                    paddingBottom={1}
                    data-testid={`chart-score-${ev.id}`}
                  >
                    <Text
                      fontSize="xs"
                      fontWeight="medium"
                      marginBottom={2}
                      lineClamp={1}
                      title={`${ev.name} (Score)`}
                    >
                      {ev.name} (Score)
                    </Text>
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <BarChart
                        data={chartData}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid
                          horizontal={true}
                          vertical={false}
                          stroke="#EDF2F7"
                          strokeDasharray="0"
                        />
                        <XAxis
                          dataKey="name"
                          style={{ fontSize: "11px" }}
                          axisLine={false}
                          tickLine={false}
                          angle={shouldRotateLabels ? -45 : 0}
                          textAnchor={shouldRotateLabels ? "end" : "middle"}
                          height={shouldRotateLabels ? 60 : 25}
                          tickFormatter={(value) =>
                            truncateLabel(
                              String(value),
                              shouldRotateLabels
                                ? MAX_LABEL_LENGTH_ROTATED
                                : MAX_LABEL_LENGTH,
                            )
                          }
                        />
                        <YAxis
                          style={{ fontSize: "11px" }}
                          width={40}
                          domain={[0, 1]}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) => (value as number).toFixed(2)}
                        />
                        <Bar dataKey={`score_${ev.id}`}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={
                                (entry as any).color ??
                                RUN_COLORS[index % RUN_COLORS.length]
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                ),
            )}

            {/* Per-evaluator pass rate charts */}
            {passRateEvaluators.map(
              (ev) =>
                visibleMetrics.has(`pass_${ev.id}` as MetricType) && (
                  <Box
                    key={`pass-${ev.id}`}
                    minWidth="280px"
                    width="280px"
                    flexShrink={0}
                    bg="bg.subtle"
                    borderRadius="md"
                    padding={3}
                    paddingBottom={1}
                    data-testid={`chart-pass-${ev.id}`}
                  >
                    <Text
                      fontSize="xs"
                      fontWeight="medium"
                      marginBottom={2}
                      lineClamp={1}
                      title={`${ev.name} (Pass Rate)`}
                    >
                      {ev.name} (Pass Rate)
                    </Text>
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <BarChart
                        data={chartData}
                        margin={{ left: 10, right: 10 }}
                      >
                        <CartesianGrid
                          horizontal={true}
                          vertical={false}
                          stroke="#EDF2F7"
                          strokeDasharray="0"
                        />
                        <XAxis
                          dataKey="name"
                          style={{ fontSize: "11px" }}
                          axisLine={false}
                          tickLine={false}
                          angle={shouldRotateLabels ? -45 : 0}
                          textAnchor={shouldRotateLabels ? "end" : "middle"}
                          height={shouldRotateLabels ? 60 : 25}
                          tickFormatter={(value) =>
                            truncateLabel(
                              String(value),
                              shouldRotateLabels
                                ? MAX_LABEL_LENGTH_ROTATED
                                : MAX_LABEL_LENGTH,
                            )
                          }
                        />
                        <YAxis
                          style={{ fontSize: "11px" }}
                          width={40}
                          domain={[0, 1]}
                          tickFormatter={(value) =>
                            `${Math.round((value as number) * 100)}%`
                          }
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) =>
                            `${Math.round((value as number) * 100)}%`
                          }
                        />
                        <Bar dataKey={`pass_${ev.id}`}>
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={
                                (entry as any).color ??
                                RUN_COLORS[index % RUN_COLORS.length]
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                ),
            )}
          </HStack>
        </VStack>
      </VStack>
    )
  );
};
