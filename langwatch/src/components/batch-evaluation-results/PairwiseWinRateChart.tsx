/**
 * PairwiseWinRateChart - Win-rate bar chart per pairwise evaluator (#5100
 * dogfood follow-up).
 *
 * Replaces the generic "avg score" chart auto-generated for pairwise
 * evaluators, which was misleading because it plotted a `0/1` chip score
 * with empty bars for the non-scored prompt targets participating in the
 * comparison. Users read the empty bars as prompts "scoring zero" — a
 * confusing signal that has nothing to do with the pairwise verdict.
 *
 * Renders three bars per pairwise evaluator (`Variant A` / `Variant B` /
 * `Tie`) using resolved variant names on the x-axis. The tally is the
 * actual pairwise story: which candidate won more rows overall.
 */

import { Card, Text, VStack } from "@chakra-ui/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BatchPairwiseColumn } from "./types";

const BAR_COLORS = {
  a: "#22C55E",
  b: "#8B5CF6",
  tie: "#94A3B8",
};

const CHART_HEIGHT = 220;

export type PairwiseWinRateChartProps = {
  column: BatchPairwiseColumn;
};

export function PairwiseWinRateChart({ column }: PairwiseWinRateChartProps) {
  const verdicts = Object.values(column.verdictsByRow);
  const counts: Record<"A" | "B" | "tie", number> = { A: 0, B: 0, tie: 0 };
  for (const v of verdicts) counts[v.label] += 1;

  const chartData = [
    {
      key: "a",
      name: column.variantAName,
      wins: counts.A,
      color: BAR_COLORS.a,
    },
    {
      key: "b",
      name: column.variantBName,
      wins: counts.B,
      color: BAR_COLORS.b,
    },
    {
      key: "tie",
      name: "Tie",
      wins: counts.tie,
      color: BAR_COLORS.tie,
    },
  ];

  const total = counts.A + counts.B + counts.tie;
  const yMax = Math.max(1, ...chartData.map((d) => d.wins));

  return (
    <Card.Root minWidth="280px" flex={1}>
      <Card.Body padding={4}>
        <VStack align="stretch" gap={1} paddingBottom={2}>
          <Text fontSize="sm" fontWeight="medium">
            {column.name} — win rate
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {total} verdict{total === 1 ? "" : "s"} · {column.variantAName} vs{" "}
            {column.variantBName}
          </Text>
        </VStack>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--chakra-colors-border-muted)"
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--chakra-colors-fg-muted)" }}
              interval={0}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, yMax]}
              tick={{ fontSize: 11, fill: "var(--chakra-colors-fg-muted)" }}
              width={28}
            />
            <Tooltip
              cursor={{ fill: "var(--chakra-colors-bg-muted)" }}
              contentStyle={{
                background: "var(--chakra-colors-bg-panel)",
                border: "1px solid var(--chakra-colors-border)",
                borderRadius: 6,
                fontSize: 12,
              }}
              formatter={(value) => [`${value}`, "Wins"]}
            />
            <Bar dataKey="wins" name="Wins" radius={[4, 4, 0, 0]}>
              <LabelList
                dataKey="wins"
                position="top"
                style={{
                  fontSize: 11,
                  fill: "var(--chakra-colors-fg-muted)",
                }}
              />
              {chartData.map((d) => (
                <Cell key={d.key} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card.Body>
    </Card.Root>
  );
}
