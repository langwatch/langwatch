/**
 * LeaderboardTrustPanel — whether the verdict above is worth acting on.
 *
 * Replaces three separate warning banners that only appeared when something
 * was wrong. Silence is a bad way to communicate "this is fine": a reader
 * cannot tell a clean run from a check that was never made. Each condition
 * is therefore stated either way, so the absence of a warning is visible
 * evidence rather than an assumption.
 *
 * Checks come in two kinds, and conflating them would be a mistake. Some
 * are pass/fail — the sample was big enough or it wasn't. Others are
 * measurements the reader has to interpret: how much longer the winner's
 * answers were, whether the judge shares a model family with a candidate.
 * A measurement rendered in warning colours fires on legitimate runs often
 * enough to train people to skip the panel, so those are reported in
 * neutral type and left to the reader.
 */
import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuInfo, LuTriangleAlert } from "react-icons/lu";

import type { BTLeaderboard } from "./computeBTLeaderboard";
import {
  VERBOSITY_NOTABLE_RATIO,
  type JudgeIndependence,
  type VerbosityProfile,
} from "./computeJudgeBiasChecks";
import type { SampleAdequacy } from "./computeSampleAdequacy";

export type LeaderboardTrustPanelProps = {
  leaderboard: BTLeaderboard;
  /** Matchups per variant below which scores are treated as unstable. */
  warnThreshold: number;
  sampleAdequacy: SampleAdequacy;
  verbosity: VerbosityProfile;
  judgeIndependence: JudgeIndependence;
  variantNames: Record<string, string>;
};

/**
 * `ok` and `warn` are judgements the panel is making. `note` is a
 * measurement it is reporting — true either way, and not a defect.
 */
export type TrustTone = "ok" | "warn" | "note";

export type TrustCheck = {
  label: string;
  detail: string;
  tone: TrustTone;
};

const nameOf = (id: string, variantNames: Record<string, string>): string =>
  variantNames[id] ?? id;

const joinNames = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** Exported for tests: the checks that decide whether a run is trustworthy. */
export const buildTrustChecks = ({
  leaderboard,
  warnThreshold,
  sampleAdequacy,
  verbosity,
  judgeIndependence,
  variantNames,
}: LeaderboardTrustPanelProps): TrustCheck[] => {
  const checks: TrustCheck[] = [
    {
      label: "Enough comparisons",
      tone: leaderboard.minMatchups >= warnThreshold ? "ok" : "warn",
      detail:
        leaderboard.minMatchups >= warnThreshold
          ? `Every variant was compared at least ${leaderboard.minMatchups} times.`
          : `The least-compared variant has only ${leaderboard.minMatchups} of the ${warnThreshold} matchups needed for a stable score. Run more rows.`,
    },
    {
      label: "Every variant both won and lost",
      tone: leaderboard.hasDegenerate ? "warn" : "ok",
      detail: leaderboard.hasDegenerate
        ? "At least one variant never won, or never lost. There is no score that fits that, so it is excluded from the ranking."
        : "No variant swept or was swept, so all of them can be placed on the same scale.",
    },
    {
      label: "Ranking settled",
      tone: leaderboard.didConverge ? "ok" : "warn",
      detail: leaderboard.didConverge
        ? "The ranking converged on a stable answer."
        : "The ranking did not fully settle, so treat the order as approximate.",
    },
  ];

  // How much of the order this run actually established. Deliberately a
  // count of what happened rather than an estimate of what more rows would
  // buy: a required-sample figure is a power calculation over an effect
  // size drawn from this same thin data, so "20 more will settle it" is a
  // promise the run cannot keep.
  checks.push(buildResolutionCheck(sampleAdequacy));
  checks.push(buildVerbosityCheck(verbosity));
  checks.push(buildJudgeIndependenceCheck(judgeIndependence, variantNames));

  return checks;
};

const buildResolutionCheck = (adequacy: SampleAdequacy): TrustCheck => {
  const { separatedPairs, totalPairs, comparisonCount } = adequacy;

  if (totalPairs === 0) {
    return {
      label: "How much this run settled",
      tone: "note",
      detail: `Only one variant could be placed on the scale, so there is no pair to separate. Based on ${comparisonCount} comparisons.`,
    };
  }

  if (separatedPairs === 0) {
    return {
      label: "How much this run settled",
      tone: "warn",
      detail: `None of the ${totalPairs} variant pairs were separated — every score sits inside every other's margin of error. ${comparisonCount} comparisons was not enough to order these variants.`,
    };
  }

  return {
    label: "How much this run settled",
    tone: separatedPairs === totalPairs ? "ok" : "note",
    detail:
      separatedPairs === totalPairs
        ? `All ${totalPairs} variant pairs were separated, so the run establishes a full order. Based on ${comparisonCount} comparisons.`
        : `${separatedPairs} of ${totalPairs} variant pairs were separated; the rest are within each other's margin of error. Based on ${comparisonCount} comparisons.`,
  };
};

/**
 * Verbosity bias: judges score longer answers higher regardless of quality.
 * Reported as a ratio and never as a failure — for plenty of tasks the
 * longer answer genuinely is the better one, and the reader is the one who
 * knows which task this is.
 */
const buildVerbosityCheck = (verbosity: VerbosityProfile): TrustCheck => {
  const { leaderRatio } = verbosity;

  if (leaderRatio === null) {
    return {
      label: "Answer length",
      tone: "note",
      detail:
        "Not enough output text was recorded to compare how long each variant's answers were.",
    };
  }

  if (leaderRatio >= VERBOSITY_NOTABLE_RATIO) {
    return {
      label: "Answer length",
      tone: "note",
      detail: `The leading variant's answers averaged ${leaderRatio.toFixed(
        1,
      )}× the length of the rest of the field. Judges tend to favour longer answers, so consider whether the extra length is doing real work here.`,
    };
  }

  if (leaderRatio <= 1 / VERBOSITY_NOTABLE_RATIO) {
    return {
      label: "Answer length",
      tone: "note",
      detail: `The leading variant's answers averaged ${leaderRatio.toFixed(
        1,
      )}× the length of the rest of the field — it won while writing less, which is the opposite of the usual length bias.`,
    };
  }

  return {
    label: "Answer length",
    tone: "ok",
    detail: `The leading variant's answers were about as long as everyone else's (${leaderRatio.toFixed(
      1,
    )}×), so length is unlikely to be what won it.`,
  };
};

/**
 * Self-preference: a judge rates its own model family's output higher. The
 * judge model is read off the run, not off the evaluator's current config,
 * so editing the evaluator later cannot retroactively change what this says
 * about an old run.
 */
const buildJudgeIndependenceCheck = (
  independence: JudgeIndependence,
  variantNames: Record<string, string>,
): TrustCheck => {
  const { judgeModel, sharedFamilyVariantIds } = independence;

  if (!judgeModel) {
    return {
      label: "Judge independence",
      tone: "note",
      detail:
        "This run did not record which model judged it, so whether the judge shares a model family with a candidate cannot be checked.",
    };
  }

  if (sharedFamilyVariantIds.length > 0) {
    const names = joinNames(
      sharedFamilyVariantIds.map((id) => nameOf(id, variantNames)),
    );
    return {
      label: "Judge independence",
      tone: "warn",
      detail: `The judge (${judgeModel}) shares a model family with ${names}. Judges tend to rate their own family's output higher, so discount that variant's lead accordingly.`,
    };
  }

  return {
    label: "Judge independence",
    tone: "ok",
    detail: `Judged by ${judgeModel}, which shares a model family with none of the candidates.`,
  };
};

const TONE_STYLES: Record<TrustTone, { color: string; icon: typeof LuCheck }> =
  {
    ok: { color: "green.fg", icon: LuCheck },
    warn: { color: "orange.fg", icon: LuTriangleAlert },
    note: { color: "fg.muted", icon: LuInfo },
  };

export function LeaderboardTrustPanel(props: LeaderboardTrustPanelProps) {
  const checks = buildTrustChecks(props);

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" color="fg.muted">
        Based on {props.leaderboard.comparisonCount} head-to-head comparisons
        the judge resolved.
      </Text>
      {checks.map((check) => {
        const style = TONE_STYLES[check.tone];
        return (
          <HStack key={check.label} align="start" gap={2}>
            <Box marginTop="2px" color={style.color} flexShrink={0}>
              <Icon as={style.icon} boxSize="13px" />
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
        );
      })}
    </VStack>
  );
}
