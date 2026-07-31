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

import type { BTLeaderboard } from "./computeBTLeaderboard";
import { computeParetoDominance } from "./computeParetoDominance";
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

export function ParetoScatterChart({
  leaderboard,
  variantMetrics,
  variantNames,
  targetColors,
  chartHeight = 260,
}: ParetoScatterChartProps) {
  const [xAxisMetric, setXAxisMetric] = useState<ParetoAxis>("cost");
  const sizeMetric: ParetoAxis = xAxisMetric === "cost" ? "duration" : "cost";

  // Recomputed here rather than passed down. It is O(n²) over the ranked
  // variants — single digits in practice — so unlike the bootstrap fit there
  // is nothing to save by hoisting it, and both this chart and the sentence
  // beside it stay derivable from the props they already take.
  const dominance = useMemo(
    () => computeParetoDominance({ leaderboard, variantMetrics }),
    [leaderboard, variantMetrics],
  );

  const data = useMemo(() => {
    const readMetric = (variantId: string, metric: ParetoAxis) => {
      const metrics = variantMetrics[variantId];
      const stats =
        metric === "cost" ? metrics?.costStats : metrics?.durationStats;
      return stats?.avg ?? null;
    };

    const readMeanCI = (variantId: string, metric: ParetoAxis) => {
      const metrics = variantMetrics[variantId];
      const ci =
        metric === "cost" ? metrics?.costMeanCI : metrics?.durationMeanCI;
      return ci?.every((bound) => Number.isFinite(bound)) ? ci : null;
    };

    return leaderboard.entries
      .map((entry, index) => {
        // Offsets, not bounds — recharts draws the bar relative to the point.
        // A non-finite bound means there is no interval to draw, and drawing
        // nothing is the honest rendering of that. Bound as a value rather
        // than a boolean so the reader below can index it.
        const ci = entry.scoreCI;
        const scoreCI = ci?.every((bound) => Number.isFinite(bound))
          ? ci
          : null;

        const x = readMetric(entry.variantId, xAxisMetric);
        const xCI = readMeanCI(entry.variantId, xAxisMetric);

        return {
          variantId: entry.variantId,
          name: variantNames[entry.variantId] ?? entry.variantId,
          score: entry.score,
          x,
          // Same offset form as the y bar. Clamped at zero because the
          // resampled mean can land below the point estimate by more than the
          // point estimate itself on a skewed cost distribution, and a
          // negative arm would render as a bar pointing the wrong way.
          xOffsets:
            xCI && x !== null
              ? ([Math.max(0, x - xCI[0]), Math.max(0, xCI[1] - x)] as [
                  number,
                  number,
                ])
              : undefined,
          xCI,
          size: readMetric(entry.variantId, sizeMetric),
          dominated: (dominance.dominatedBy[entry.variantId]?.length ?? 0) > 0,
          ciOffsets: scoreCI
            ? ([entry.score - scoreCI[0], scoreCI[1] - entry.score] as [
                number,
                number,
              ])
            : undefined,
          color:
            targetColors?.[entry.variantId] ??
            VARIANT_COLORS[index % VARIANT_COLORS.length]!,
        };
      })
      .filter((d): d is typeof d & { x: number } => d.x !== null);
  }, [
    leaderboard.entries,
    variantMetrics,
    variantNames,
    targetColors,
    xAxisMetric,
    sizeMetric,
    dominance,
  ]);

  const formatX = xAxisMetric === "cost" ? formatCost : formatDuration;
  const formatSize = sizeMetric === "cost" ? formatCost : formatDuration;
  const xLabel = xAxisMetric === "cost" ? "Avg cost" : "Avg duration";
  const sizeLabel = sizeMetric === "cost" ? "avg cost" : "avg duration";

  const sizeIsMeaningful = data.some((d) => d.size !== null);
  const anyInterval = data.some((d) => d.ciOffsets !== undefined);
  const anyXInterval = data.some((d) => d.xOffsets !== undefined);
  const anyDominated = data.some((d) => d.dominated);

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between" flexWrap="wrap">
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Quality vs. {xLabel.toLowerCase()}
        </Text>
        <HStack gap={1}>
          <Button
            size="2xs"
            variant={xAxisMetric === "cost" ? "solid" : "ghost"}
            onClick={() => setXAxisMetric("cost")}
          >
            Cost
          </Button>
          <Button
            size="2xs"
            variant={xAxisMetric === "duration" ? "solid" : "ghost"}
            onClick={() => setXAxisMetric("duration")}
          >
            Duration
          </Button>
        </HStack>
      </HStack>

      {data.length === 0 ? (
        <Text fontSize="xs" color="fg.muted" textAlign="center" paddingY={6}>
          No {xAxisMetric} data recorded for these variants yet.
        </Text>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <ScatterChart margin={{ top: 14, right: 24, left: 10, bottom: 10 }}>
              <CartesianGrid
                stroke="var(--chakra-colors-border)"
                strokeDasharray="3 3"
              />
              <XAxis
                type="number"
                dataKey="x"
                name={xLabel}
                tickFormatter={(v) => formatX(v as number)}
                style={{ fontSize: "11px" }}
                tick={{ fill: "var(--chakra-colors-fg-muted)" }}
              />
              <YAxis
                type="number"
                dataKey="score"
                name="BT score"
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
                name={sizeLabel}
                range={sizeIsMeaningful ? SIZE_RANGE : FLAT_SIZE_RANGE}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const point = payload[0].payload as (typeof data)[number];
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
                        BT score: {point.score.toFixed(2)}
                        {point.ciOffsets
                          ? ` (${(point.score - point.ciOffsets[0]).toFixed(
                              0,
                            )} to ${(point.score + point.ciOffsets[1]).toFixed(0)})`
                          : ""}
                      </Text>
                      <Text>
                        {xLabel}: {formatX(point.x)}
                        {point.xCI
                          ? ` (${formatX(point.xCI[0])} to ${formatX(point.xCI[1])})`
                          : ""}
                      </Text>
                      {point.size !== null ? (
                        <Text>
                          {sizeMetric === "cost" ? "Avg cost" : "Avg duration"}:{" "}
                          {formatSize(point.size)}
                        </Text>
                      ) : null}
                      {point.dominated ? (
                        <Text color="fg.muted">
                          Beaten outright by another variant
                        </Text>
                      ) : null}
                    </VStack>
                  );
                }}
              />
              <Scatter data={data} name="Variants">
                {/*
                  Drawn before the cells so the bar sits under the point.
                  Muted rather than per-variant coloured: the bar is a
                  statement about uncertainty, not another category to track.
                */}
                {anyInterval ? (
                  <ErrorBar
                    dataKey="ciOffsets"
                    direction="y"
                    width={4}
                    strokeWidth={1.5}
                    stroke="var(--chakra-colors-fg-muted)"
                  />
                ) : null}
                {/*
                  The horizontal arm. Same visual weight and colour as the
                  vertical one because they are the same kind of statement —
                  a 95% bootstrap interval for where the true value lies —
                  and styling them differently would imply otherwise.
                */}
                {anyXInterval ? (
                  <ErrorBar
                    dataKey="xOffsets"
                    direction="x"
                    width={4}
                    strokeWidth={1.5}
                    stroke="var(--chakra-colors-fg-muted)"
                  />
                ) : null}
                {data.map((d) => (
                  <Cell
                    key={d.variantId}
                    fill={d.color}
                    // Beaten outright on every metric — hollowed out so the
                    // eye lands on the variants still in contention without
                    // having to read the sentence first.
                    fillOpacity={d.dominated ? 0.25 : 0.9}
                    stroke={d.color}
                    strokeWidth={d.dominated ? 1.5 : 0}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          <VStack align="start" gap={0}>
            {sizeIsMeaningful ? (
              <Text fontSize="xs" color="fg.muted">
                Point size is {sizeLabel} — bigger is{" "}
                {sizeMetric === "cost" ? "dearer" : "slower"}.
              </Text>
            ) : (
              <Text fontSize="xs" color="fg.muted">
                No {sizeMetric} was recorded, so point size means nothing here.
              </Text>
            )}
            {anyInterval ? (
              <Text fontSize="xs" color="fg.muted">
                Bars are 95% confidence intervals — vertically for the score,
                {anyXInterval
                  ? ` horizontally for the ${xLabel.toLowerCase()}. Both say where the true value lies, not how much individual rows varied.`
                  : "."}
              </Text>
            ) : null}
            {anyDominated ? (
              <Text fontSize="xs" color="fg.muted">
                Hollow points are beaten outright on every metric shown.
              </Text>
            ) : null}
          </VStack>
        </>
      )}
    </VStack>
  );
}
