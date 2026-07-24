/**
 * ComparisonLeaderboardDrawer - full Bradley-Terry leaderboard view (#5103).
 *
 * Structured as three questions in the order a reader actually has them:
 * what should I ship, can I believe that, and what do I do about it. The
 * first step alone is meant to be a defensible answer — someone who reads
 * nothing else should still leave with the right variant. The detail that
 * used to lead (a sortable score table) now sits under step 3, because it
 * answers "why" for people who want it rather than "what" for everyone.
 *
 * Opened from ComparisonLeaderboardChart's expand affordance. Data
 * (`column`, `rows`, `targetColors`) is passed via drawer complexProps
 * rather than refetched — it's the same data already loaded on the results
 * page, and these can be large enough that URL serialization would be the
 * wrong tool.
 */
import { Box, Separator, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { buildPairwiseComparisons } from "./batch-evaluation-results/buildPairwiseComparisons";
import { computeBTLeaderboard } from "./batch-evaluation-results/computeBTLeaderboard";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "./batch-evaluation-results/computeLeaderboardVerdict";
import { computeVariantMetrics } from "./batch-evaluation-results/computeVariantMetrics";
import { LeaderboardStep } from "./batch-evaluation-results/LeaderboardStep";
import { LeaderboardTrustPanel } from "./batch-evaluation-results/LeaderboardTrustPanel";
import { LeaderboardVerdictPanel } from "./batch-evaluation-results/LeaderboardVerdictPanel";
import { ParetoScatterChart } from "./batch-evaluation-results/ParetoScatterChart";
import { PairwiseLeaderboard } from "./batch-evaluation-results/PairwiseLeaderboard";
import type { BatchComparisonColumn, BatchResultRow } from "./batch-evaluation-results/types";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "./ui/drawer";

export type ComparisonLeaderboardDrawerProps = {
  evaluatorId: string;
  column: BatchComparisonColumn;
  rows: BatchResultRow[];
  targetColors?: Record<string, string>;
};

/** Matchups per variant below which Bradley-Terry scores are unstable. */
const WARN_THRESHOLD = 30;

export function ComparisonLeaderboardDrawer({
  column,
  rows,
  targetColors,
}: ComparisonLeaderboardDrawerProps) {
  const { closeDrawer } = useDrawer();
  const [selectedPair, setSelectedPair] = useState<{
    winnerId: string;
    opponentId: string;
  } | null>(null);

  const variantIds = useMemo(
    () => column.variants.map((v) => v.id).filter((id): id is string => !!id),
    [column.variants],
  );
  const variantNames = useMemo(
    () =>
      Object.fromEntries(column.variants.map((v) => [v.id ?? "", v.name])),
    [column.variants],
  );

  const leaderboard = useMemo(
    () => computeBTLeaderboard(buildPairwiseComparisons(column), variantIds),
    [column, variantIds],
  );
  const variantMetrics = useMemo(
    () => computeVariantMetrics(variantIds, rows),
    [variantIds, rows],
  );

  const verdict = useMemo(
    () => computeLeaderboardVerdict(leaderboard),
    [leaderboard],
  );
  const cheaperAlternative = useMemo(
    () => findCheaperTiedAlternative({ verdict, variantMetrics }),
    [verdict, variantMetrics],
  );

  const trustHasProblem =
    leaderboard.minMatchups < WARN_THRESHOLD ||
    leaderboard.hasDegenerate ||
    !leaderboard.didConverge;

  // Every row where `winnerId` beat `opponentId` directly — the judge's own
  // reasoning text, filtered down to exactly the matchup the user clicked.
  const matchupReasons = useMemo(() => {
    if (!selectedPair) return [];
    const { winnerId, opponentId } = selectedPair;
    return Object.values(column.verdictsByRow).filter(
      (v) =>
        v.winnerId === winnerId &&
        (v.candidateIds ?? []).includes(winnerId) &&
        (v.candidateIds ?? []).includes(opponentId) &&
        v.reasoning,
    );
  }, [column.verdictsByRow, selectedPair]);

  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={closeDrawer}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {column.name} — leaderboard
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4} paddingBottom={6}>
            <LeaderboardStep
              index={1}
              title="Which one should you ship?"
              subtitle="The ranking, and whether the run actually separates them."
            >
              <LeaderboardVerdictPanel
                leaderboard={leaderboard}
                verdict={verdict}
                cheaperAlternative={cheaperAlternative}
                variantNames={variantNames}
                targetColors={targetColors}
              />
            </LeaderboardStep>

            <LeaderboardStep
              index={2}
              title="Can you trust that?"
              subtitle="What this run does and does not support."
              hasProblem={trustHasProblem}
            >
              <LeaderboardTrustPanel
                leaderboard={leaderboard}
                warnThreshold={WARN_THRESHOLD}
              />
            </LeaderboardStep>

            <LeaderboardStep
              index={3}
              title="What is it costing you, and why did it win?"
              subtitle="Trade-offs, head-to-head detail, and the judge's own reasoning."
            >
              <VStack align="stretch" gap={4}>
                <ParetoScatterChart
                  leaderboard={leaderboard}
                  variantMetrics={variantMetrics}
                  variantNames={variantNames}
                  targetColors={targetColors}
                />

                <Separator />

                <PairwiseLeaderboard
                  leaderboard={leaderboard}
                  variantNames={variantNames}
                  warnThreshold={WARN_THRESHOLD}
                  showWarnings={false}
                  onCellClick={(winnerId, opponentId) =>
                    setSelectedPair({ winnerId, opponentId })
                  }
                />

                {selectedPair ? (
                  <Box
                    borderWidth="1px"
                    borderColor="border.muted"
                    borderRadius="md"
                    padding={3}
                  >
                    <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
                      {variantNames[selectedPair.winnerId] ??
                        selectedPair.winnerId}{" "}
                      vs{" "}
                      {variantNames[selectedPair.opponentId] ??
                        selectedPair.opponentId}
                    </Text>
                    {matchupReasons.length === 0 ? (
                      <Text fontSize="xs" color="fg.muted">
                        No reasoning recorded for this matchup.
                      </Text>
                    ) : (
                      <VStack align="stretch" gap={2}>
                        {matchupReasons.map((v, i) => (
                          <Box key={v.rowIndex}>
                            <Text fontSize="xs" color="fg.muted">
                              Row {v.rowIndex + 1}
                            </Text>
                            <Text fontSize="sm">{v.reasoning}</Text>
                            {i < matchupReasons.length - 1 ? (
                              <Separator marginTop={2} />
                            ) : null}
                          </Box>
                        ))}
                      </VStack>
                    )}
                  </Box>
                ) : null}
              </VStack>
            </LeaderboardStep>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
