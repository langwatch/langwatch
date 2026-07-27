/**
 * LeaderboardAskLangyButton — hands the finished comparison result to Langy.
 *
 * An earlier version of this called a model directly and rendered the
 * paragraph it returned inside the panel. That was wrong twice over. It
 * duplicated an assistant the platform already has, down to needing its own
 * model configured before the button worked at all. And a generated
 * paragraph rendered *inside* the result panel sits at the same visual
 * authority as the computed verdict beside it, which is exactly how
 * fluent-but-wrong output gets acted on.
 *
 * Handing it to Langy fixes both. The explanation lands in the assistant
 * panel, visibly a conversation rather than part of the chart; the reader
 * can push back on it, ask what to change, or ask it to look at the rows —
 * none of which a frozen paragraph can do; and it runs on the model the
 * workspace already picked for Langy.
 *
 * The computed conclusion goes INTO the question (see
 * buildLeaderboardLangyPrompt) so Langy explains the ranking on screen
 * instead of quietly deriving a second one.
 */
import { Button, Icon } from "@chakra-ui/react";
import { LuSparkles } from "react-icons/lu";

import { useCanAskLangy } from "~/features/langy/hooks/useCanAskLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { buildLeaderboardLangyPrompt } from "./buildLeaderboardLangyPrompt";
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

export type LeaderboardAskLangyButtonProps = {
  comparisonName: string;
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

export function LeaderboardAskLangyButton({
  comparisonName,
  leaderboard,
  verdict,
  cheaperAlternative,
  sampleAdequacy,
  verbosity,
  judgeIndependence,
  variantMetrics,
  variantNames,
  warnThreshold,
}: LeaderboardAskLangyButtonProps) {
  const canAsk = useCanAskLangy();
  const askLangy = useLangyStore((s) => s.askLangy);

  // `langy:create` is a different grant from `langy:view`, and a send
  // without it comes back 403 — so a reader who cannot start a turn is not
  // offered the door. The panel above still tells them everything the run
  // established; only the conversation is unavailable.
  if (!canAsk) return null;

  // Nothing to explain when the run produced no ranking. The sentence
  // directly above the button already says so in full.
  if (verdict.kind === "no-signal") return null;

  const onAsk = () => {
    askLangy(
      buildLeaderboardLangyPrompt({
        comparisonName,
        headline: formatLeaderboardHeadline({
          verdict,
          cheaperAlternative,
          variantNames,
        }),
        leaderboard,
        sampleAdequacy,
        variantMetrics,
        variantNames,
        checks: buildTrustChecks({
          leaderboard,
          warnThreshold,
          sampleAdequacy,
          verbosity,
          judgeIndependence,
          variantNames,
        }),
      }),
    );
  };

  return (
    <Button size="xs" variant="outline" alignSelf="start" onClick={onAsk}>
      <Icon as={LuSparkles} boxSize="12px" color="orange.fg" />
      Ask Langy to explain this
    </Button>
  );
}
