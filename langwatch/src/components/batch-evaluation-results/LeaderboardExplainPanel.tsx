/**
 * LeaderboardExplainPanel — the optional written explanation.
 *
 * Three deliberate constraints, each one guarding against a specific way
 * this component could make the feature worse than not having it:
 *
 *  1. Nothing is generated until asked. Opening the drawer must not spend
 *     the workspace's model budget on a paragraph most readers will skip,
 *     and a summary that appears automatically reads as part of the
 *     analysis rather than as generated text.
 *  2. It renders BELOW the computed verdict, never in place of it. The
 *     sentence that decides what to ship is a pure function of the scores
 *     (formatLeaderboardHeadline) and stays on screen unchanged. If the two
 *     ever disagree, the computed one is the one the reader is looking at.
 *  3. The model that wrote it is named. An unattributed paragraph next to a
 *     chart is read with the chart's authority, which is exactly the
 *     failure mode where fluent-but-wrong output gets acted on.
 */
import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuSparkles } from "react-icons/lu";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { BTLeaderboard } from "./computeBTLeaderboard";
import type {
  JudgeIndependence,
  VerbosityProfile,
} from "./computeJudgeBiasChecks";
import type {
  CheaperAlternative,
  LeaderboardVerdict,
} from "./computeLeaderboardVerdict";
import type { SampleAdequacy } from "./computeSampleAdequacy";
import type { VariantMetrics } from "./computeVariantMetrics";
import { formatLeaderboardHeadline } from "./formatLeaderboardHeadline";
import { buildTrustChecks } from "./LeaderboardTrustPanel";

export type LeaderboardExplainPanelProps = {
  leaderboard: BTLeaderboard;
  verdict: LeaderboardVerdict;
  cheaperAlternative: CheaperAlternative | null;
  sampleAdequacy: SampleAdequacy;
  verbosity: VerbosityProfile;
  judgeIndependence: JudgeIndependence;
  variantMetrics: Record<string, VariantMetrics>;
  variantNames: Record<string, string>;
  /** Matchups per variant below which scores are treated as unstable. */
  warnThreshold: number;
};

/** Non-finite figures are dropped rather than sent as NaN for the model to read. */
const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function LeaderboardExplainPanel({
  leaderboard,
  verdict,
  cheaperAlternative,
  sampleAdequacy,
  verbosity,
  judgeIndependence,
  variantMetrics,
  variantNames,
  warnThreshold,
}: LeaderboardExplainPanelProps) {
  const { project } = useOrganizationTeamProject();
  const [result, setResult] = useState<{
    explanation: string;
    model: string;
  } | null>(null);

  const explain = api.leaderboardExplanation.explain.useMutation({
    onSuccess: setResult,
  });

  // Nothing to put into words when the run produced no ranking at all —
  // offering to explain "no ranking yet" would spend a model call to
  // restate the sentence directly above the button.
  if (verdict.kind === "no-signal") return null;

  const onExplain = () => {
    if (!project) return;

    const headline = formatLeaderboardHeadline({
      verdict,
      cheaperAlternative,
      variantNames,
    });

    // Only the computed figures cross the wire — never the per-row verdicts
    // or the candidates' own text. A model that could see the raw run could
    // re-derive a different winner; one handed the finished table can only
    // narrate it.
    explain.mutate({
      projectId: project.id,
      facts: {
        verdictKind: verdict.kind,
        headline: headline.heading,
        headlineDetail: headline.detail,
        comparisonCount: sampleAdequacy.comparisonCount,
        separatedPairs: sampleAdequacy.separatedPairs,
        totalPairs: sampleAdequacy.totalPairs,
        entries: leaderboard.entries.slice(0, 30).map((entry) => ({
          name: variantNames[entry.variantId] ?? entry.variantId,
          score: entry.score,
          ciLow: finite(entry.scoreCI?.[0]),
          ciHigh: finite(entry.scoreCI?.[1]),
          winRate: entry.winRate,
          matchups: entry.matchups,
          degenerate: entry.degenerate,
          avgCost: finite(variantMetrics[entry.variantId]?.costStats?.avg),
          avgDurationMs: finite(
            variantMetrics[entry.variantId]?.durationStats?.avg,
          ),
        })),
        checks: buildTrustChecks({
          leaderboard,
          warnThreshold,
          sampleAdequacy,
          verbosity,
          judgeIndependence,
          variantNames,
        }),
      },
    });
  };

  if (result) {
    return (
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={3}
        bg="bg.subtle"
      >
        <Text fontSize="sm" lineHeight="1.6">
          {result.explanation}
        </Text>
        <Text fontSize="2xs" color="fg.muted" marginTop={2}>
          Written by {result.model} from the figures above. The conclusion
          shown above it is computed, not generated.
        </Text>
      </Box>
    );
  }

  return (
    <HStack gap={2}>
      <Button
        size="xs"
        variant="outline"
        onClick={onExplain}
        loading={explain.isLoading}
        disabled={!project}
      >
        <Icon as={LuSparkles} boxSize="12px" />
        Explain this in plain language
      </Button>
      {explain.error ? (
        <Text fontSize="2xs" color="red.fg">
          Could not generate an explanation. The result above is unaffected.
        </Text>
      ) : null}
    </HStack>
  );
}
