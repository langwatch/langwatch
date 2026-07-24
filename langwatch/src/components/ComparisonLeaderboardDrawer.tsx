/**
 * ComparisonLeaderboardDrawer - full Bradley-Terry leaderboard view (#5103).
 *
 * Opened from ComparisonLeaderboardChart's expand affordance. Data (`column`,
 * `rows`, `targetColors`) is passed via drawer complexProps rather than
 * refetched — it's the same data already loaded on the results page, and
 * these can be large enough that URL serialization would be the wrong tool.
 */
import { Box, Separator, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { buildPairwiseComparisons } from "./batch-evaluation-results/buildPairwiseComparisons";
import { computeBTLeaderboard } from "./batch-evaluation-results/computeBTLeaderboard";
import { computeVariantMetrics } from "./batch-evaluation-results/computeVariantMetrics";
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
          <VStack align="stretch" gap={5} paddingBottom={6}>
            <PairwiseLeaderboard
              leaderboard={leaderboard}
              variantNames={variantNames}
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
                  {variantNames[selectedPair.winnerId] ?? selectedPair.winnerId}{" "}
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

            <Separator />

            <ParetoScatterChart
              leaderboard={leaderboard}
              variantMetrics={variantMetrics}
              variantNames={variantNames}
              targetColors={targetColors}
            />
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
