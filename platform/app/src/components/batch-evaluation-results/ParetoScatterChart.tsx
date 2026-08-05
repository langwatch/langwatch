/**
 * ParetoScatterChart — quality, cost and speed at once (#5103).
 *
 * Deliberately a separate scatter, not a blended "best overall" score folding
 * quality together with cost or duration — there is no principled exchange
 * rate between BT strength points and dollars or milliseconds, so any fixed
 * weighting would be arbitrary. This answers "is a cheaper/faster variant
 * meaningfully worse?" by inspection instead.
 *
 * All three metrics are on the chart, but only two of them are positions.
 * The third rides on point SIZE rather than a third spatial axis, and that
 * is a deliberate refusal rather than a limitation of the charting library:
 *
 *   - Depth in a perspective projection is the least accurate quantitative
 *     channel there is. Two points that read as adjacent can be far apart,
 *     and the reader has to rotate the scene to recover a value — which
 *     makes extracting a single fact an interaction rather than a glance.
 *
 *   - Worse, the y positions carry ERROR BARS, and whether two intervals
 *     overlap is the one thing that decides if a quality gap is real. Two
 *     intervals foreshortened at different depths cannot be compared at all.
 *     A 3D scene would therefore hide precisely the uncertainty the rest of
 *     this feature exists to keep visible, while looking more authoritative
 *     for doing so.
 *
 * Reading three metrics off a scatter is still work, so the chart does not
 * have to carry the conclusion on its own: `computeParetoDominance` answers
 * "is anything beaten outright?" exactly, and variants that are lose their
 * fill here to match the sentence stated alongside.
 */
import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ErrorBar,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { BTLeaderboard, BTLeaderboardEntry } from "./computeBTLeaderboard";
import {
  computeParetoDominance,
  type ParetoDominance,
} from "./computeParetoDominance";
import type { VariantMetrics } from "./computeVariantMetrics";
import { VARIANT_COLORS } from "./WinRateChart";

export type ParetoAxis = "cost" | "duration";

export type ParetoScatterChartProps = {
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
  variantNames: Record<string, string>;
  targetColors?: Record<string, string>;
  chartHeight?: number;
};

const formatCost = (value: number): string =>
  value < 0.0001 ? `$${value.toExponential(2)}` : `$${value.toFixed(4)}`;

const formatDuration = (value: number): string =>
  value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;

/** Point-area range, in px², for the metric mapped to size. */
const SIZE_RANGE: [number, number] = [70, 420];
/** Every point the same size, for when the third metric has no data. */
const FLAT_SIZE_RANGE: [number, number] = [110, 110];

/**
 * Both interval arms, styled identically on purpose: they are the same kind of
 * statement — a 95% bootstrap interval for where the true value lies — and
 * styling them differently would imply otherwise.
 */
const INTERVAL_BAR_STYLE = {
  width: 4,
  strokeWidth: 1.5,
  stroke: "var(--chakra-colors-fg-muted)",
} as const;

const metricTitle = (metric: ParetoAxis): string =>
  metric === "cost" ? "Avg cost" : "Avg duration";

const formatterFor = (metric: ParetoAxis): ((value: number) => string) =>
  metric === "cost" ? formatCost : formatDuration;

/** Which metric sits on which channel, plus every label and formatter for it. */
type AxisConfig = {
  xAxisMetric: ParetoAxis;
  sizeMetric: ParetoAxis;
  formatX: (value: number) => string;
  formatSize: (value: number) => string;
  /** Sentence case, for the axis name and the tooltip: "Avg cost". */
  xLabel: string;
  /** Lower case, for mid-sentence prose: "avg cost". */
  sizeLabel: string;
};

const axisConfigFor = (xAxisMetric: ParetoAxis): AxisConfig => {
  const sizeMetric: ParetoAxis = xAxisMetric === "cost" ? "duration" : "cost";
  return {
    xAxisMetric,
    sizeMetric,
    formatX: formatterFor(xAxisMetric),
    formatSize: formatterFor(sizeMetric),
    xLabel: metricTitle(xAxisMetric),
    sizeLabel: metricTitle(sizeMetric).toLowerCase(),
  };
};

/** One plotted variant. `x` is non-null by construction — see `buildParetoPoints`. */
type ParetoPoint = {
  variantId: string;
  name: string;
  score: number;
  x: number;
  xOffsets: [number, number] | undefined;
  xCI: [number, number] | null;
  size: number | null;
  dominated: boolean;
  ciOffsets: [number, number] | undefined;
  color: string;
};

/**
 * A bootstrap over a handful of rows can return an unbounded interval, and
 * there is no bar to draw for one. Drawing nothing is the honest rendering.
 */
const finiteCI = (
  ci: [number, number] | null | undefined,
): [number, number] | null =>
  ci?.every((bound) => Number.isFinite(bound)) ? ci : null;

const readAvg = ({
  metrics,
  metric,
}: {
  metrics: VariantMetrics | undefined;
  metric: ParetoAxis;
}): number | null => {
  const stats = metric === "cost" ? metrics?.costStats : metrics?.durationStats;
  return stats?.avg ?? null;
};

const readMeanCI = ({
  metrics,
  metric,
}: {
  metrics: VariantMetrics | undefined;
  metric: ParetoAxis;
}): [number, number] | null =>
  finiteCI(metric === "cost" ? metrics?.costMeanCI : metrics?.durationMeanCI);

/**
 * Offsets, not bounds — recharts draws the bar relative to the point.
 *
 * `clampAtZero` is for the x arm: on a skewed cost distribution the resampled
 * mean can land below the point estimate by more than the point estimate
 * itself, and a negative arm renders as a bar pointing the wrong way.
 */
const offsetsAround = ({
  value,
  ci,
  clampAtZero = false,
}: {
  value: number;
  ci: [number, number] | null;
  clampAtZero?: boolean;
}): [number, number] | undefined => {
  if (!ci) return undefined;
  const low = value - ci[0];
  const high = ci[1] - value;
  return clampAtZero ? [Math.max(0, low), Math.max(0, high)] : [low, high];
};

/** Exported for tests: the points the scatter actually draws. */
export const buildParetoPoints = ({
  entries,
  variantMetrics,
  variantNames,
  targetColors,
  axis,
  dominance,
}: {
  entries: BTLeaderboardEntry[];
  variantMetrics: Record<string, VariantMetrics>;
  variantNames: Record<string, string>;
  targetColors: Record<string, string> | undefined;
  axis: AxisConfig;
  dominance: ParetoDominance;
}): ParetoPoint[] =>
  entries
    // Degenerate variants are excluded here for the same reason
    // `computeParetoDominance` excludes them and the trust panel says they are
    // excluded: a variant that never won or never lost has no maximum-
    // likelihood score, so the number it carries is a smoothing artifact.
    // Plotting it anyway put a variant that swept every matchup at the TOP of
    // the quality axis, and because `dominatedBy` is built over ranked
    // variants only it got no entry there, so it drew solid — the styling
    // that means "still in contention" — while the table beside it said the
    // score was not a measurement.
    .filter((entry) => !entry.isDegenerate)
    .map((entry, index): ParetoPoint | null => {
      const metrics = variantMetrics[entry.variantId];
      const x = readAvg({ metrics, metric: axis.xAxisMetric });
      // No reading for the x metric means no position on this chart, so the
      // variant is dropped rather than drawn at zero.
      if (x === null) return null;

      const xCI = readMeanCI({ metrics, metric: axis.xAxisMetric });
      return {
        variantId: entry.variantId,
        name: variantNames[entry.variantId] ?? entry.variantId,
        score: entry.score,
        x,
        xOffsets: offsetsAround({ value: x, ci: xCI, clampAtZero: true }),
        xCI,
        size: readAvg({ metrics, metric: axis.sizeMetric }),
        dominated: (dominance.dominatedBy[entry.variantId]?.length ?? 0) > 0,
        ciOffsets: offsetsAround({
          value: entry.score,
          ci: finiteCI(entry.scoreCI),
        }),
        color:
          targetColors?.[entry.variantId] ??
          VARIANT_COLORS[index % VARIANT_COLORS.length]!,
      };
    })
    .filter((point): point is ParetoPoint => point !== null);

export function ParetoScatterChart({
  leaderboard,
  variantMetrics,
  variantNames,
  targetColors,
  chartHeight = 260,
}: ParetoScatterChartProps) {
  const [xAxisMetric, setXAxisMetric] = useState<ParetoAxis>("cost");
  const axis = useMemo(() => axisConfigFor(xAxisMetric), [xAxisMetric]);

  // Recomputed here rather than passed down. It is O(n²) over the ranked
  // variants — single digits in practice — so unlike the bootstrap fit there
  // is nothing to save by hoisting it, and both this chart and the sentence
  // beside it stay derivable from the props they already take.
  const dominance = useMemo(
    () => computeParetoDominance({ leaderboard, variantMetrics }),
    [leaderboard, variantMetrics],
  );

  const data = useMemo(
    () =>
      buildParetoPoints({
        entries: leaderboard.entries,
        variantMetrics,
        variantNames,
        targetColors,
        axis,
        dominance,
      }),
    [
      leaderboard.entries,
      variantMetrics,
      variantNames,
      targetColors,
      axis,
      dominance,
    ],
  );

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between" flexWrap="wrap">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Quality vs. {axis.xLabel.toLowerCase()}
        </Text>
        <AxisPicker value={xAxisMetric} onChange={setXAxisMetric} />
      </HStack>

      {data.length === 0 ? (
        <Text fontSize="xs" color="fg.muted" textAlign="center" paddingY={6}>
          No {xAxisMetric} data recorded for these variants yet.
        </Text>
      ) : (
        <>
          <ParetoPlot data={data} axis={axis} chartHeight={chartHeight} />
          <ParetoNotes data={data} axis={axis} />
        </>
      )}
    </VStack>
  );
}

function AxisPicker({
  value,
  onChange,
}: {
  value: ParetoAxis;
  onChange: (metric: ParetoAxis) => void;
}) {
  return (
    // `aria-pressed` because which axis is showing is signalled only by the
    // solid-vs-ghost variant, which a screen reader does not see — without it
    // the two buttons are announced identically whichever one is active.
    <HStack gap={1}>
      <Button
        size="2xs"
        variant={value === "cost" ? "solid" : "ghost"}
        aria-pressed={value === "cost"}
        onClick={() => onChange("cost")}
      >
        Cost
      </Button>
      <Button
        size="2xs"
        variant={value === "duration" ? "solid" : "ghost"}
        aria-pressed={value === "duration"}
        onClick={() => onChange("duration")}
      >
        Duration
      </Button>
    </HStack>
  );
}

/**
 * Beaten outright on every metric — hollowed out so the eye lands on the
 * variants still in contention without having to read the sentence first.
 */
const renderPointCell = (point: ParetoPoint) => (
  <Cell
    key={point.variantId}
    fill={point.color}
    fillOpacity={point.dominated ? 0.25 : 0.9}
    stroke={point.color}
    strokeWidth={point.dominated ? 1.5 : 0}
  />
);

function ParetoPlot({
  data,
  axis,
  chartHeight,
}: {
  data: ParetoPoint[];
  axis: AxisConfig;
  chartHeight: number;
}) {
  const sizeIsMeaningful = data.some((point) => point.size !== null);
  const anyInterval = data.some((point) => point.ciOffsets !== undefined);
  const anyXInterval = data.some((point) => point.xOffsets !== undefined);

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <ScatterChart margin={{ top: 14, right: 24, left: 10, bottom: 10 }}>
        <CartesianGrid
          stroke="var(--chakra-colors-border)"
          strokeDasharray="3 3"
        />
        <XAxis
          type="number"
          dataKey="x"
          name={axis.xLabel}
          tickFormatter={(v) => axis.formatX(v as number)}
          style={{ fontSize: "11px" }}
          tick={{ fill: "var(--chakra-colors-fg-muted)" }}
        />
        <YAxis
          type="number"
          dataKey="score"
          name="Score"
          style={{ fontSize: "11px" }}
          tick={{ fill: "var(--chakra-colors-fg-muted)" }}
          width={40}
        />
        {/*
          The third metric. Range is area in px², so the mapping stays
          perceptually honest — encoding it as radius would square the
          apparent difference and make a 2x slower variant look 4x worse.
        */}
        <ZAxis
          type="number"
          dataKey="size"
          name={axis.sizeLabel}
          range={sizeIsMeaningful ? SIZE_RANGE : FLAT_SIZE_RANGE}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ active, payload }) => (
            <ParetoTooltip
              active={active}
              point={payload?.[0]?.payload as ParetoPoint | undefined}
              axis={axis}
            />
          )}
        />
        <Scatter data={data} name="Variants">
          {/* Drawn before the cells so the bars sit under the point. */}
          {anyInterval ? (
            <ErrorBar
              dataKey="ciOffsets"
              direction="y"
              {...INTERVAL_BAR_STYLE}
            />
          ) : null}
          {anyXInterval ? (
            <ErrorBar
              dataKey="xOffsets"
              direction="x"
              {...INTERVAL_BAR_STYLE}
            />
          ) : null}
          {data.map(renderPointCell)}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function ParetoTooltip({
  active,
  point,
  axis,
}: {
  active?: boolean;
  point?: ParetoPoint;
  axis: AxisConfig;
}) {
  if (!active || !point) return null;

  return (
    <VStack
      align="start"
      gap={0}
      bg="bg.panel"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={2}
      fontSize="xs"
    >
      <Text fontWeight="semibold">{point.name}</Text>
      <Text>
        Score: {point.score.toFixed(2)}
        {point.ciOffsets
          ? ` (${(point.score - point.ciOffsets[0]).toFixed(
              0,
            )} to ${(point.score + point.ciOffsets[1]).toFixed(0)})`
          : ""}
      </Text>
      <Text>
        {axis.xLabel}: {axis.formatX(point.x)}
        {point.xCI
          ? ` (${axis.formatX(point.xCI[0])} to ${axis.formatX(point.xCI[1])})`
          : ""}
      </Text>
      {point.size !== null ? (
        <Text>
          {metricTitle(axis.sizeMetric)}: {axis.formatSize(point.size)}
        </Text>
      ) : null}
      {point.dominated ? (
        <Text color="fg.muted">Beaten outright by another variant</Text>
      ) : null}
    </VStack>
  );
}

function ParetoNotes({
  data,
  axis,
}: {
  data: ParetoPoint[];
  axis: AxisConfig;
}) {
  const sizeIsMeaningful = data.some((point) => point.size !== null);
  const anyInterval = data.some((point) => point.ciOffsets !== undefined);
  const anyXInterval = data.some((point) => point.xOffsets !== undefined);
  const anyDominated = data.some((point) => point.dominated);

  return (
    <VStack align="start" gap={0}>
      {sizeIsMeaningful ? (
        <Text fontSize="xs" color="fg.muted">
          Point size is {axis.sizeLabel} — bigger is{" "}
          {axis.sizeMetric === "cost" ? "dearer" : "slower"}.
        </Text>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          No {axis.sizeMetric} was recorded, so point size means nothing here.
        </Text>
      )}
      {anyInterval ? (
        <Text fontSize="xs" color="fg.muted">
          Bars are 95% confidence intervals — vertically for the score,
          {anyXInterval
            ? ` horizontally for the ${axis.xLabel.toLowerCase()}. Both say where the true value lies, not how much individual rows varied.`
            : "."}
        </Text>
      ) : null}
      {anyDominated ? (
        <Text fontSize="xs" color="fg.muted">
          Hollow points are beaten outright on every metric shown.
        </Text>
      ) : null}
    </VStack>
  );
}
