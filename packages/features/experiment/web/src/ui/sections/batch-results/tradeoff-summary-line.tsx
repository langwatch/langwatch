/**
 * The trade-off chart's conclusion, rendered above the chart rather than
 * below it (#5103).
 *
 * Order is the point. A reader who stops after one line should still have
 * the answer; the scatter underneath is for checking it, not for reaching
 * it. Placing this after the chart would make the chart the primary reading
 * and this a footnote to work the reader already did.
 */
import { HStack, Icon, Text } from "@chakra-ui/react";
import { useMemo } from "react";
import { LuInfo, LuScissors } from "react-icons/lu";

import type { BTLeaderboard } from "../../../model/batch-evaluation-results.bt-leaderboard";
import { computeParetoDominance } from "../batch-evaluation-results.pareto";
import type { VariantMetrics } from "../batch-evaluation-results.variant-metrics";
import { formatTradeoffSummary } from "../batch-evaluation-results.tradeoff";

export type TradeoffSummaryLineProps = {
  leaderboard: BTLeaderboard;
  variantMetrics: Record<string, VariantMetrics>;
  variantNames: Record<string, string>;
};

export function TradeoffSummaryLine({
  leaderboard,
  variantMetrics,
  variantNames,
}: TradeoffSummaryLineProps) {
  const summary = useMemo(() => {
    const dominance = computeParetoDominance({ leaderboard, variantMetrics });
    return formatTradeoffSummary({ dominance, variantNames });
  }, [leaderboard, variantMetrics, variantNames]);

  if (!summary) return null;

  const isActionable = summary.tone === "actionable";

  return (
    <HStack
      align="start"
      gap={2}
      borderWidth="1px"
      borderColor={isActionable ? "orange.emphasized" : "border.muted"}
      borderRadius="md"
      padding={3}
    >
      <Icon
        as={isActionable ? LuScissors : LuInfo}
        boxSize="14px"
        color={isActionable ? "orange.fg" : "fg.muted"}
        marginTop="2px"
        flexShrink={0}
      />
      <Text fontSize="sm">{summary.headline}</Text>
    </HStack>
  );
}
