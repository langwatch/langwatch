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
import { useDrawer } from "~/hooks/useDrawer";
import { buildPairwiseComparisons } from "./buildPairwiseComparisons";
import { axisLabelProps, buildAxisLabels, truncateLabel } from "./chartAxisLabels";
import { computeBTLeaderboard } from "./computeBTLeaderboard";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "./computeLeaderboardVerdict";
import { computeVariantMetrics } from "./computeVariantMetrics";
import { formatLeaderboardHeadline } from "./formatLeaderboardHeadline";
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
  /** Model each target ran on, as recorded on the run. Forwarded to the drawer. */
  modelByTargetId?: Record<string, string | null>;
  /** Model that judged this comparison, as recorded on the run. */
  judgeModel?: string | null;
};

export function ComparisonLeaderboardChart({
  column,
  rows,
  chartHeight,
  targetColors,
  modelByTargetId,
  judgeModel,
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
  const displayNames = buildAxisLabels(
    leaderboard.entries.map((e) => nameById.get(e.variantId) ?? e.variantId),
    axis.maxLabelLength,
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

  // The conclusion, on the card itself. Bars alone leave the reader to
  // eyeball whether the tallest one is meaningfully ahead, which is exactly
  // the judgement the confidence intervals exist to make — and the tallest
  // bar is frequently NOT a winner the run can defend.
  //
  // Shares formatLeaderboardHeadline with the drawer rather than phrasing it
  // again here. Two copies drift, and the card's copy had already lost the
  // cheaper-tied-alternative case — so a run whose answer was "ship the one
  // that costs 75% less" read as a flat "too close to call" until you opened
  // the drawer.
  const variantNames = useMemo(
    () => Object.fromEntries(column.variants.map((v) => [v.id ?? "", v.name])),
    [column.variants],
  );
  const verdict = computeLeaderboardVerdict(leaderboard);
  const variantMetrics = useMemo(
    () => computeVariantMetrics(variantIds, rows),
    [variantIds, rows],
  );
  const cheaperAlternative = useMemo(
    () => findCheaperTiedAlternative({ verdict, variantMetrics }),
    [verdict, variantMetrics],
  );
  const headline = formatLeaderboardHeadline({
    verdict,
    cheaperAlternative,
    variantNames,
  });
  const headlineColor =
    headline.tone === "positive"
      ? "green.fg"
      : headline.tone === "caution"
        ? "orange.fg"
        : "fg.muted";

  const onExpand = () => {
    // Passed straight through openDrawer (not a separate setComplexProps
    // call) — openDrawer's own updateDrawerUrl recomputes complexProps from
    // whatever props it was given and would otherwise clobber a prior
    // setComplexProps call with an empty object, since evaluatorId alone is
    // URL-serializable.
    openDrawer("comparisonLeaderboard", {
      evaluatorId: column.evaluatorId,
      column,
      rows,
      targetColors,
      modelByTargetId,
      judgeModel,
    });
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
        {/* Always visible, just quiet. Revealing this only on hover made the
            one route into the full leaderboard invisible until you happened to
            mouse over the card — and unreachable altogether by keyboard or on
            a touch screen, where there is no hover at all. Subdued by default,
            full strength on hover or keyboard focus. */}
        <IconButton
          aria-label="Expand leaderboard"
          size="2xs"
          variant="ghost"
          opacity={0.55}
          _groupHover={{ opacity: 1 }}
          _focusVisible={{ opacity: 1 }}
          transition="opacity 0.15s"
          onClick={onExpand}
        >
          <LuMaximize2 size={12} />
        </IconButton>
      </HStack>
      <Text
        fontSize="2xs"
        fontWeight="semibold"
        color={headlineColor}
        lineClamp={1}
        marginBottom={1}
        title={`${headline.heading} — ${headline.detail}`}
      >
        {headline.heading}
      </Text>
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
