/**
 * ComparisonLeaderboardChart - compact Bradley-Terry ranking card (#5103).
 *
 * Sibling of WinRateChart in the same metrics row — same card treatment,
 * same width, same target colors — but ranks variants by Bradley-Terry
 * score (transitive, opponent-strength-aware) rather than a raw win tally.
 * Only meaningful once naive win-rate risks being non-transitive, so this
 * mounts starting at 3 variants; below that WinRateChart already tells the
 * whole story.
 *
 * The compact card can't show a leaderboard's full detail (confidence
 * intervals, the win-matrix, cost/duration tradeoffs) — the expand button
 * opens the full view in a drawer (specs/experiments/comparison-leaderboard.feature).
 */
import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { LuMaximize2 } from "react-icons/lu";
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
import { setComplexProps, useDrawer } from "~/hooks/useDrawer";
import { buildPairwiseComparisons } from "./buildPairwiseComparisons";
import { axisLabelProps, truncateLabel } from "./chartAxisLabels";
import { computeBTLeaderboard } from "./computeBTLeaderboard";
import type { BatchComparisonColumn, BatchResultRow } from "./types";
import { VARIANT_COLORS } from "./WinRateChart";

/** Compact card shows only this many bars before collapsing the rest into "+N more". */
const MAX_COMPACT_BARS = 4;

export type ComparisonLeaderboardChartProps = {
  column: BatchComparisonColumn;
  rows: BatchResultRow[];
  /** Matched to the sibling cost/latency/win-rate charts in ComparisonCharts. */
  chartHeight: number;
  targetColors?: Record<string, string>;
};

export function ComparisonLeaderboardChart({
  column,
  rows,
  chartHeight,
  targetColors,
}: ComparisonLeaderboardChartProps) {
  const { openDrawer } = useDrawer();

  const variantIds = useMemo(
    () => column.variants.map((v) => v.id).filter((id): id is string => !!id),
    [column.variants],
  );

  const leaderboard = useMemo(
    () => computeBTLeaderboard(buildPairwiseComparisons(column), variantIds),
    [column, variantIds],
  );

  const nameById = new Map(column.variants.map((v) => [v.id, v.name]));
  const axis = axisLabelProps(Math.min(leaderboard.entries.length, MAX_COMPACT_BARS));
  const trimAxisLabel = (s: string) => truncateLabel(s, axis.maxLabelLength);
  const displayNames = disambiguateNames(
    leaderboard.entries.map((e) => trimAxisLabel(nameById.get(e.variantId) ?? e.variantId)),
  );
  const fullNames = disambiguateNames(
    leaderboard.entries.map((e) => nameById.get(e.variantId) ?? e.variantId),
  );

  const shown = leaderboard.entries.slice(0, MAX_COMPACT_BARS);
  const hiddenCount = leaderboard.entries.length - shown.length;

  const chartData = shown.map((e, index) => ({
    key: e.variantId,
    name: displayNames[index] ?? e.variantId,
    fullName: fullNames[index] ?? e.variantId,
    score: e.score,
    color:
      targetColors?.[e.variantId] ?? VARIANT_COLORS[index % VARIANT_COLORS.length]!,
  }));

  const yMax = Math.max(1, ...chartData.map((d) => Math.abs(d.score)));

  const onExpand = () => {
    setComplexProps({ column, rows, targetColors });
    openDrawer("comparisonLeaderboard", { evaluatorId: column.evaluatorId });
  };

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
      data-testid={`chart-leaderboard-${column.evaluatorId}`}
      role="group"
    >
      <HStack justify="space-between" marginBottom={2}>
        <Text
          fontSize="xs"
          fontWeight="medium"
          lineClamp={1}
          title={`${column.name} — leaderboard`}
        >
          {column.name} — leaderboard
        </Text>
        <IconButton
          aria-label="Expand leaderboard"
          size="2xs"
          variant="ghost"
          opacity={0}
          _groupHover={{ opacity: 1 }}
          transition="opacity 0.15s"
          onClick={onExpand}
        >
          <LuMaximize2 size={12} />
        </IconButton>
      </HStack>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 20 }}>
          <CartesianGrid
            horizontal={false}
            vertical={true}
            stroke="var(--chakra-colors-border)"
            strokeDasharray="0"
          />
          <XAxis
            type="number"
            domain={[-yMax, yMax]}
            style={{ fontSize: "11px" }}
            tick={{ fill: "var(--chakra-colors-fg-muted)" }}
            hide
          />
          <YAxis
            type="category"
            dataKey="name"
            width={axis.maxLabelLength * 6 + 10}
            style={{ fontSize: "11px" }}
            tick={{ fill: "var(--chakra-colors-fg-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--chakra-colors-bg-muted)" }}
            contentStyle={{
              background: "var(--chakra-colors-bg-panel)",
              border: "1px solid var(--chakra-colors-border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value) => [(value as number).toFixed(2), "BT score"]}
            labelFormatter={(label, payload) =>
              (payload?.[0]?.payload as { fullName?: string } | undefined)
                ?.fullName ?? label
            }
          />
          <Bar dataKey="score" name="BT score" radius={[0, 4, 4, 0]}>
            <LabelList
              dataKey="score"
              position="right"
              formatter={(v) => (typeof v === "number" ? v.toFixed(2) : String(v ?? ""))}
              style={{ fontSize: 11, fill: "var(--chakra-colors-fg)" }}
            />
            {chartData.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {hiddenCount > 0 ? (
        <Text fontSize="2xs" color="fg.muted" textAlign="center" paddingBottom={1}>
          +{hiddenCount} more — expand for the full leaderboard
        </Text>
      ) : null}
    </Box>
  );
}
