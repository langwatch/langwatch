/**
 * WinRateChart - Win-rate bar chart per comparison evaluator (#5100 dogfood
 * follow-up, generalized to N candidates in #5101).
 *
 * Replaces the generic "avg score" chart auto-generated for comparison
 * evaluators, which was misleading because it plotted a `0/1` chip score
 * with empty bars for the non-scored prompt targets participating in the
 * comparison. Users read the empty bars as prompts "scoring zero" — a
 * confusing signal that has nothing to do with the comparison verdict.
 *
 * Renders one bar per variant plus a Tie bar, using resolved variant names on
 * the x-axis. The tally is the actual comparison story: which candidate won
 * more rows overall. This is where the per-variant breakdown lives — the
 * workbench column header only names the overall winner.
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

import type { BatchComparisonColumn } from "./types";

/**
 * Fallback only, for a variant whose target this run has no colour for.
 * Deliberately excludes red: a losing variant isn't a failure, so no bar
 * should read as one. Ties get their own gray.
 */
const VARIANT_COLORS = [
  "#22C55E",
  "#8B5CF6",
  "#0EA5E9",
  "#F59E0B",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
  "#84CC16",
];
const TIE_COLOR = "#94A3B8";

export type WinRateChartProps = {
  column: BatchComparisonColumn;
  /** Matched to the sibling cost/latency charts in ComparisonCharts. */
  chartHeight: number;
  /**
   * Per-target colours used by the sibling Cost / Latency charts and the
   * table's target dots. Reused here so one variant is one colour everywhere
   * on the page — otherwise a prompt reads blue in the table and green here.
   */
  targetColors?: Record<string, string>;
};

// Truncate the variant name so the axis label doesn't wrap or overflow the
// narrow 280px column. Recharts doesn't tick-wrap by default; the sibling
// charts trim at ~10 chars, so we match that.
const trimAxisLabel = (s: string) => (s.length > 10 ? `${s.slice(0, 9)}…` : s);

export function WinRateChart({
  column,
  chartHeight,
  targetColors,
}: WinRateChartProps) {
  const verdicts = Object.values(column.verdictsByRow);

  const winsByVariantId = new Map<string, number>();
  let ties = 0;
  for (const verdict of verdicts) {
    if (verdict.winnerId === null) {
      ties += 1;
      continue;
    }
    winsByVariantId.set(
      verdict.winnerId,
      (winsByVariantId.get(verdict.winnerId) ?? 0) + 1,
    );
  }

  const chartData = [
    ...column.variants.map((variant, index) => ({
      key: variant.id ?? `variant-${index}`,
      name: trimAxisLabel(variant.name),
      wins: variant.id ? (winsByVariantId.get(variant.id) ?? 0) : 0,
      color:
        (variant.id ? targetColors?.[variant.id] : undefined) ??
        VARIANT_COLORS[index % VARIANT_COLORS.length]!,
    })),
    { key: "tie", name: "Tie", wins: ties, color: TIE_COLOR },
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
      data-testid={`chart-comparison-${column.evaluatorId}`}
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
