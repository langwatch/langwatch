/**
 * LeaderboardTrustPanel — whether the verdict above is worth acting on.
 *
 * Replaces three separate warning banners that only appeared when something
 * was wrong. Silence is a bad way to communicate "this is fine": a reader
 * cannot tell a clean run from a check that was never made. Each condition
 * is therefore stated either way, so the absence of a warning is visible
 * evidence rather than an assumption.
 */
import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuTriangleAlert } from "react-icons/lu";

import type { BTLeaderboard } from "./computeBTLeaderboard";

export type LeaderboardTrustPanelProps = {
  leaderboard: BTLeaderboard;
  /** Matchups per variant below which scores are treated as unstable. */
  warnThreshold: number;
};

export type TrustCheck = {
  label: string;
  detail: string;
  ok: boolean;
};

/** Exported for tests: the checks that decide whether a run is trustworthy. */
export const buildTrustChecks = ({
  leaderboard,
  warnThreshold,
}: LeaderboardTrustPanelProps): TrustCheck[] => [
  {
    label: "Enough comparisons",
    ok: leaderboard.minMatchups >= warnThreshold,
    detail:
      leaderboard.minMatchups >= warnThreshold
        ? `Every variant was compared at least ${leaderboard.minMatchups} times.`
        : `The least-compared variant has only ${leaderboard.minMatchups} of the ${warnThreshold} matchups needed for a stable score. Run more rows.`,
  },
  {
    label: "Every variant both won and lost",
    ok: !leaderboard.hasDegenerate,
    detail: leaderboard.hasDegenerate
      ? "At least one variant never won, or never lost. There is no score that fits that, so it is excluded from the ranking."
      : "No variant swept or was swept, so all of them can be placed on the same scale.",
  },
  {
    label: "Ranking settled",
    ok: leaderboard.didConverge,
    detail: leaderboard.didConverge
      ? "The ranking converged on a stable answer."
      : "The ranking did not fully settle, so treat the order as approximate.",
  },
];

export function LeaderboardTrustPanel({
  leaderboard,
  warnThreshold,
}: LeaderboardTrustPanelProps) {
  const checks = buildTrustChecks({ leaderboard, warnThreshold });

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" color="fg.muted">
        Based on {leaderboard.comparisonCount} head-to-head comparisons the
        judge resolved.
      </Text>
      {checks.map((check) => (
        <HStack key={check.label} align="start" gap={2}>
          <Box
            marginTop="2px"
            color={check.ok ? "green.fg" : "orange.fg"}
            flexShrink={0}
          >
            <Icon
              as={check.ok ? LuCheck : LuTriangleAlert}
              boxSize="13px"
            />
          </Box>
          <Box>
            <Text fontSize="xs" fontWeight="semibold">
              {check.label}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {check.detail}
            </Text>
          </Box>
        </HStack>
      ))}
    </VStack>
  );
}
