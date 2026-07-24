/**
 * ParetoScatterChart - Bradley-Terry score vs. cost/duration tradeoff (#5103).
 *
 * Deliberately a separate scatter, not a blended "best overall" score folding
 * quality together with cost or duration — there is no principled exchange
 * rate between BT strength points and dollars or milliseconds, so any fixed
 * weighting would be arbitrary. This answers "is a cheaper/faster variant
 * meaningfully worse?" by inspection instead.
 */
import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import type { BTLeaderboard } from "./computeBTLeaderboard";
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

export function ParetoScatterChart({
  leaderboard,
  variantMetrics,
  variantNames,
  targetColors,
  chartHeight = 260,
}: ParetoScatterChartProps) {
  const [xAxisMetric, setXAxisMetric] = useState<ParetoAxis>("cost");

  const data = useMemo(() => {
    return leaderboard.entries
      .map((entry, index) => {
        const metrics = variantMetrics[entry.variantId];
        const x =
          xAxisMetric === "cost"
            ? (metrics?.costStats?.avg ?? null)
            : (metrics?.durationStats?.avg ?? null);
        return {
          variantId: entry.variantId,
          name: variantNames[entry.variantId] ?? entry.variantId,
          score: entry.score,
          x,
          color:
            targetColors?.[entry.variantId] ??
            VARIANT_COLORS[index % VARIANT_COLORS.length]!,
        };
      })
      .filter((d): d is typeof d & { x: number } => d.x !== null);
  }, [leaderboard.entries, variantMetrics, variantNames, targetColors, xAxisMetric]);

  const formatX = xAxisMetric === "cost" ? formatCost : formatDuration;
  const xLabel = xAxisMetric === "cost" ? "Avg cost" : "Avg duration";

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
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
            <CartesianGrid stroke="var(--chakra-colors-border)" strokeDasharray="3 3" />
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
            <ZAxis range={[80, 80]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{
                background: "var(--chakra-colors-bg-panel)",
                border: "1px solid var(--chakra-colors-border)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value, name) =>
                name === "BT score"
                  ? [(value as number).toFixed(2), name]
                  : [formatX(value as number), xLabel]
              }
              labelFormatter={() => ""}
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
                    <Text>BT score: {point.score.toFixed(2)}</Text>
                    <Text>
                      {xLabel}: {formatX(point.x)}
                    </Text>
                  </VStack>
                );
              }}
            />
            <Scatter data={data} name="Variants">
              {data.map((d) => (
                <Cell key={d.variantId} fill={d.color} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </VStack>
  );
}
