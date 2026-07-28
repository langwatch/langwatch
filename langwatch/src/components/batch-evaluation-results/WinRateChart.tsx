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

import { disambiguateNames } from "~/experiments-v3/utils/variantDisambiguation";
import { axisLabelProps, truncateLabel } from "./chartAxisLabels";

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

// Label trimming/rotation is shared with the Cost and Latency charts
// (chartAxisLabels.ts) so the same variant reads identically on every chart of
// the results page. This chart used to hand-roll its own 10-char trim and never
// rotate, which is why its axis was the least readable of the three.

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

  // Two variants can share a display name (e.g. the same prompt handle run
  // twice with different configs) while still having distinct target ids and
  // win tallies (see buildVariantIdentifiers in orchestrator.ts). Without
  // disambiguation the chart would render two bars labeled identically —
  // correct data, unreadable axis. Mirrors ComparisonColumnHeader's use of
  // the same utility for the workbench column header.
  //
  // Trim BEFORE disambiguating, not after: two colliding names are still
  // colliding once truncated to the same prefix (truncation is deterministic),
  // so collision detection is unaffected — but disambiguating first and
  // trimming second would truncate the " (1)"/" (2)" suffix right back off
  // for any name within a few characters of the budget (e.g. "gpt-5-mini (1)"
  // and "gpt-5-mini (2)" both collapse to the identical "gpt-5-min…",
  // silently reintroducing the exact bug this fixes).
  //
  // The bar count includes the Tie bar, so the rotation threshold is judged on
  // what's actually rendered.
  const axis = axisLabelProps(column.variants.length + 1);
  const trimAxisLabel = (s: string) => truncateLabel(s, axis.maxLabelLength);
  const variantNames = disambiguateNames(
    column.variants.map((v) => trimAxisLabel(v.name)),
  );
  // Untruncated counterpart of the axis labels, for the hover tooltip — the
  // axis stays elided so it can't eat the chart, and the full name is one
  // hover away. Disambiguated the same way so "(1)"/"(2)" still identify the
  // same bar in both places.
  const variantFullNames = disambiguateNames(column.variants.map((v) => v.name));

  const chartData = [
    ...column.variants.map((variant, index) => ({
      key: variant.id ?? `variant-${index}`,
      name: variantNames[index] ?? trimAxisLabel(variant.name),
      fullName: variantFullNames[index] ?? variant.name,
      wins: variant.id ? (winsByVariantId.get(variant.id) ?? 0) : 0,
      color:
        (variant.id ? targetColors?.[variant.id] : undefined) ??
        VARIANT_COLORS[index % VARIANT_COLORS.length]!,
    })),
    { key: "tie", name: "Tie", fullName: "Tie", wins: ties, color: TIE_COLOR },
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
          {/* Same axis treatment as the Cost / Latency charts on this page —
              slanted once there are enough bars, with the height reserved for
              the diagonal. `interval={0}` keeps every bar labelled (a dropped
              tick here would leave a bar with no variant name at all). */}
          <XAxis
            dataKey="name"
            interval={0}
            axisLine={false}
            tickLine={false}
            angle={axis.angle}
            textAnchor={axis.textAnchor}
            height={axis.height}
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
            // The axis label is elided; the tooltip is where the full variant
            // name lives, so hovering a bar always tells you exactly which
            // variant it is.
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as { fullName?: string } | undefined)
                ?.fullName ?? label
            }
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
