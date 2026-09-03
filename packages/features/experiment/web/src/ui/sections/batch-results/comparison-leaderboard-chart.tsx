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

import { disambiguateNames } from "./presentation";
import {
  axisLabelProps,
  buildAxisLabels,
} from "../../../model/batch-evaluation-results.chart-axis";
import type { BTLeaderboard } from "../../../model/batch-evaluation-results.bt-leaderboard";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "../batch-evaluation-results.verdict";
import { formatLeaderboardHeadline } from "../batch-evaluation-results.headline";
import type { BatchComparisonColumn, BatchResultRow } from "../batch-evaluation-results.types";
import { useBTLeaderboard } from "../use-bt-leaderboard";
import { useVariantMetrics } from "../use-variant-metrics";
import { VARIANT_COLORS } from "./win-rate-chart";

/** Compact card shows only this many bars before collapsing the rest into "+N more". */
const MAX_COMPACT_BARS = 4;

/**
 * The score printed at the end of each bar.
 *
 * Hand-placed rather than `position="right"`, because recharts anchors that
 * to a NEGATIVE bar's outer (left) end — which grows toward the category
 * labels. The lowest-scoring variant is both the longest negative bar and
 * the one with the widest label, so it collided with its own name and
 * rendered as unreadable overlapping text ("…f184.51").
 *
 * One rule for both signs instead: sit just past the rect's right edge.
 * For a positive bar that is its tip; for a negative bar it is the zero
 * line, so the label always grows into the empty middle of the plot and can
 * never reach the axis.
 */
function ScoreValueLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  /** recharts' own RenderableText — number, string, null or false. */
  value?: unknown;
}) {
  const { x, y, width, height, value } = props;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const left = Number(x ?? 0);
  const barWidth = Number(width ?? 0);
  const top = Number(y ?? 0);
  const barHeight = Number(height ?? 0);

  return (
    <text
      x={left + barWidth + 4}
      y={top + barHeight / 2}
      textAnchor="start"
      dominantBaseline="central"
      style={{ fontSize: 11, fill: "var(--chakra-colors-fg)" }}
    >
      {value.toFixed(2)}
    </text>
  );
}

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
  onExpand?: (input: {
    evaluatorId: string;
    column: BatchComparisonColumn;
    rows: BatchResultRow[];
    targetColors?: Record<string, string>;
    modelByTargetId?: Record<string, string | null>;
    judgeModel?: string | null;
  }) => void;
};

/** The bars the compact card has room for, already labelled and coloured. */
const buildCompactBars = ({
  leaderboard,
  column,
  targetColors,
}: {
  leaderboard: BTLeaderboard;
  column: BatchComparisonColumn;
  targetColors?: Record<string, string>;
}) => {
  const nameById = new Map(column.variants.map((v) => [v.id, v.name]));
  const names = leaderboard.entries.map((e) => nameById.get(e.variantId) ?? e.variantId);
  const axis = axisLabelProps(Math.min(leaderboard.entries.length, MAX_COMPACT_BARS));
  const displayNames = buildAxisLabels(names, axis.maxLabelLength);
  const fullNames = disambiguateNames(names);

  const shown = leaderboard.entries.slice(0, MAX_COMPACT_BARS);
  const chartData = shown.map((e, index) => ({
    key: e.variantId,
    name: displayNames[index] ?? e.variantId,
    fullName: fullNames[index] ?? e.variantId,
    score: e.score,
    color: targetColors?.[e.variantId] ?? VARIANT_COLORS[index % VARIANT_COLORS.length]!,
  }));

  return {
    axis,
    chartData,
    hiddenCount: leaderboard.entries.length - shown.length,
    yMax: Math.max(1, ...chartData.map((d) => Math.abs(d.score))),
  };
};

const HEADLINE_COLORS = {
  positive: "green.fg",
  caution: "orange.fg",
  neutral: "fg.muted",
} as const;

/** The card's title row and, under it, the one-sentence answer. */
function LeaderboardCardHeader({
  title,
  headline,
  onExpand,
}: {
  title: string;
  headline: ReturnType<typeof formatLeaderboardHeadline>;
  onExpand: () => void;
}) {
  return (
    <>
      <HStack justify="space-between" marginBottom={2}>
        <Text fontSize="xs" fontWeight="medium" lineClamp={1} title={title}>
          {title}
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
        color={HEADLINE_COLORS[headline.tone]}
        lineClamp={1}
        marginBottom={1}
        title={`${headline.heading} — ${headline.detail}`}
      >
        {headline.heading}
      </Text>
    </>
  );
}

function LeaderboardBars({
  bars,
  chartHeight,
}: {
  bars: ReturnType<typeof buildCompactBars>;
  chartHeight: number;
}) {
  const { chartData, yMax, axis } = bars;
  return (
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
          formatter={(value) => [(value as number).toFixed(2), "Score"]}
          labelFormatter={(label, payload) =>
            (payload?.[0]?.payload as { fullName?: string } | undefined)?.fullName ?? label
          }
        />
        <Bar dataKey="score" name="Score" radius={[0, 4, 4, 0]}>
          <LabelList dataKey="score" content={ScoreValueLabel} />
          {chartData.map((d) => (
            <Cell key={d.key} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ComparisonLeaderboardChart({
  column,
  rows,
  chartHeight,
  targetColors,
  modelByTargetId,
  judgeModel,
  onExpand,
}: ComparisonLeaderboardChartProps) {
  const variantIds = useMemo(
    () => column.variants.map((v) => v.id).filter((id): id is string => !!id),
    [column.variants],
  );

  // Shared across the card and the drawer — see useBTLeaderboard. Both need
  // the same fit for the same column, and it is expensive enough that doing
  // it twice was a visible pause when the drawer opened.
  const leaderboard = useBTLeaderboard({ column, variantIds });

  const bars = buildCompactBars({ leaderboard, column, targetColors });

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
  // Shared across the card and the drawer — see useVariantMetrics. The
  // paired difference intervals made this O(variants squared) bootstraps,
  // so computing it in both places was a second visible pause.
  const variantMetrics = useVariantMetrics({ rows, variantIds });
  const cheaperAlternative = useMemo(
    () => findCheaperTiedAlternative({ verdict, variantMetrics }),
    [verdict, variantMetrics],
  );
  const headline = formatLeaderboardHeadline({
    verdict,
    cheaperAlternative,
    variantNames,
  });

  const handleExpand = () => {
    onExpand?.({
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
      <LeaderboardCardHeader
        title={`${column.name} — leaderboard`}
        headline={headline}
        onExpand={handleExpand}
      />
      <LeaderboardBars bars={bars} chartHeight={chartHeight} />
      {bars.hiddenCount > 0 ? (
        <Text fontSize="2xs" color="fg.muted" textAlign="center" paddingBottom={1}>
          +{bars.hiddenCount} more — expand for the full leaderboard
        </Text>
      ) : null}
    </Box>
  );
}
