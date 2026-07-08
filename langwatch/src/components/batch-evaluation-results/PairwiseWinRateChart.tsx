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
 *
 * Renders as a plain Box (not a Card) so `ComparisonCharts` can drop it
 * inline alongside its own Total Cost / Avg Latency chart cards without a
 * visual break — same width, same header treatment, same chartHeight.
 */

import { Box, Text } from "@chakra-ui/react";
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

export type PairwiseWinRateChartProps = {
  column: BatchPairwiseColumn;
  /** Matched to the sibling cost/latency charts in ComparisonCharts. */
  chartHeight: number;
};

// Truncate the variant name so the axis label doesn't wrap or overflow the
// narrow 280px column. Recharts doesn't tick-wrap by default; the sibling
// charts trim at ~10 chars, so we match that.
const trimAxisLabel = (s: string) => (s.length > 10 ? `${s.slice(0, 9)}…` : s);

export function PairwiseWinRateChart({
  column,
  chartHeight,
}: PairwiseWinRateChartProps) {
  const verdicts = Object.values(column.verdictsByRow);
  const counts: Record<"A" | "B" | "tie", number> = { A: 0, B: 0, tie: 0 };
  for (const v of verdicts) counts[v.label] += 1;

  const chartData = [
    {
      key: "a",
      name: trimAxisLabel(column.variantAName),
      wins: counts.A,
      color: BAR_COLORS.a,
    },
    {
      key: "b",
      name: trimAxisLabel(column.variantBName),
      wins: counts.B,
      color: BAR_COLORS.b,
    },
    { key: "tie", name: "Tie", wins: counts.tie, color: BAR_COLORS.tie },
  ];

  const yMax = Math.max(1, ...chartData.map((d) => d.wins));

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
      data-testid={`chart-pairwise-${column.evaluatorId}`}
    >
      <Text
        fontSize="xs"
        fontWeight="medium"
        marginBottom={2}
        lineClamp={1}
        title={`${column.name} — win rate`}
      >
        {column.name} — win rate
      </Text>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chartData} margin={{ left: 10, right: 10 }}>
          <CartesianGrid
            horizontal={true}
            vertical={false}
            stroke="var(--chakra-colors-border)"
            strokeDasharray="0"
          />
          <XAxis
            dataKey="name"
            interval={0}
            style={{ fontSize: "11px" }}
            tick={{ fill: "var(--chakra-colors-fg-muted)" }}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, yMax]}
            style={{ fontSize: "11px" }}
            tick={{ fill: "var(--chakra-colors-fg-muted)" }}
            width={22}
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
                fill: "var(--chakra-colors-fg)",
              }}
            />
            {chartData.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
