/**
 * LeaderboardTrustPanel — whether the verdict above is worth acting on.
 */
import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuCheck, LuInfo, LuTriangleAlert } from "react-icons/lu";

import type { BTLeaderboard } from "../../../model/batch-evaluation-results.bt-leaderboard";
import {
  type JudgeIndependence,
  VERBOSITY_NOTABLE_RATIO,
  type VerbosityProfile,
} from "../batch-evaluation-results.judge-bias";
import type { SampleAdequacy } from "../../../model/batch-evaluation-results.sample-adequacy";

export type LeaderboardTrustPanelProps = {
  leaderboard: BTLeaderboard;
  /**
   * Rows the judge ran on and declined to call. Reported because it is the
   * usual explanation for a fit that then fails to connect.
   */
  rowsWithoutVerdict?: number;
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

/**
 * Share of non-converged bootstrap replicates above which the intervals stop being
 * reported as exact.
 */
const BOOTSTRAP_NONCONVERGENCE_LIMIT = 0.02;

export type TrustCheck = {
  label: string;
  detail: string;
  tone: TrustTone;
};

const nameOf = (id: string, variantNames: Record<string, string>): string => variantNames[id] ?? id;

const joinNames = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Whether the run actually connected the field well enough to rank it.
 */
const buildComparabilityCheck = (
  leaderboard: LeaderboardTrustPanelProps["leaderboard"],
): TrustCheck => {
  const { comparability } = leaderboard;
  const groupCount = comparability.groups.length;

  if (comparability.identifiable || groupCount <= 1) {
    return {
      label: "Everything is on one scale",
      tone: "ok",
      detail:
        "Every variant is linked to the rest through wins and losses, so the whole ranking is on a single scale.",
    };
  }

  return {
    label: "Not all on one scale",
    tone: "warn",
    detail:
      `The run splits into ${groupCount} groups that it never connected by a two-way result. ` +
      "Inside a group the scores compare normally; across groups only the order is meaningful, " +
      "and the size of the gap is not — it reflects where the solver stopped rather than the evidence.",
  };
};

const buildSampleSizeCheck = ({
  leaderboard,
  warnThreshold,
}: Pick<LeaderboardTrustPanelProps, "leaderboard" | "warnThreshold">): TrustCheck => ({
  label: "Enough comparisons",
  tone: leaderboard.minMatchups >= warnThreshold ? "ok" : "warn",
  detail:
    leaderboard.minMatchups >= warnThreshold
      ? `Every variant took part in at least ${leaderboard.minMatchups} matchups.`
      : `The least-compared variant has only ${leaderboard.minMatchups} of the ${warnThreshold} matchups needed for a stable score. Run more rows.`,
});

const buildSweepCheck = (leaderboard: BTLeaderboard): TrustCheck => ({
  label: "Every variant both won and lost",
  tone: leaderboard.hasDegenerate ? "warn" : "ok",
  detail: leaderboard.hasDegenerate
    ? "At least one variant never won, or never lost. There is no score that fits that, so it is excluded from the ranking."
    : "No variant swept or was swept.",
});

/**
 * `didConverge` alone would overstate this.
 */
const buildSettledCheck = (leaderboard: BTLeaderboard): TrustCheck => ({
  label: "Ranking settled",
  tone: leaderboard.didConverge && leaderboard.comparability.identifiable ? "ok" : "warn",
  detail: !leaderboard.comparability.identifiable
    ? "The ranking cannot settle across groups the run never connected, so treat gaps that span them as unmeasured."
    : leaderboard.didConverge
      ? "The ranking converged on a stable answer."
      : "The ranking did not fully settle, so treat the order as approximate.",
});

/**
 * The margins of error are built from a thousand OTHER fits, and their failures used to
 * be discarded — so the settled check could report a clean convergence while the
 * intervals beside it came from fits that never settled.
 */
const buildMarginsCheck = (leaderboard: BTLeaderboard): TrustCheck[] => {
  const rate = leaderboard.bootstrapNonConvergence;
  if (rate === null || rate <= BOOTSTRAP_NONCONVERGENCE_LIMIT) return [];
  return [
    {
      label: "Margins of error are approximate",
      tone: "warn",
      detail: `${Math.round(
        rate * 100,
      )}% of the resamples used to size the margins of error did not settle, so treat the intervals as rough rather than exact.`,
    },
  ];
};

/**
 * Rows the judge produced no verdict for.
 */
const buildDeclinedRowsCheck = ({
  leaderboard,
  rowsWithoutVerdict,
}: Pick<LeaderboardTrustPanelProps, "leaderboard" | "rowsWithoutVerdict">): TrustCheck[] => {
  if (rowsWithoutVerdict === undefined) return [];

  const judged = leaderboard.comparisonCount;
  if (rowsWithoutVerdict === 0) {
    return [
      {
        label: "The judge called every row",
        tone: "ok",
        detail: "No row was left without a verdict.",
      },
    ];
  }

  // Amber only once the declined rows are a large enough share to be the
  // reason the ranking is thin, rather than the handful any judge produces.
  const total = judged + rowsWithoutVerdict;
  const share = total > 0 ? rowsWithoutVerdict / total : 0;
  return [
    {
      label: "Rows the judge would not call",
      tone: share >= 0.25 ? "warn" : "note",
      detail: `${rowsWithoutVerdict} of ${total} rows produced no verdict — the judge picked a different winner when the candidates were shown in the opposite order, so neither answer was recorded. Those rows contribute nothing to the ranking${
        share >= 0.25
          ? ", and at this share they are the likeliest reason it is thin. A judge this order-sensitive will not settle by running more rows; change the judge model or the prompt."
          : "."
      }`,
    },
  ];
};

/** Exported for tests: the checks that decide whether a run is trustworthy. */
export const buildTrustChecks = ({
  leaderboard,
  warnThreshold,
  sampleAdequacy,
  verbosity,
  judgeIndependence,
  variantNames,
  rowsWithoutVerdict,
}: LeaderboardTrustPanelProps): TrustCheck[] => {
  // The top variant the fit is entitled to rank — degenerates are excluded
  // from every claim, so one of them is not a leader.
  const leaderId = leaderboard.entries.find((entry) => !entry.isDegenerate)?.variantId ?? null;

  return [
    buildSampleSizeCheck({ leaderboard, warnThreshold }),
    buildSweepCheck(leaderboard),
    // Split out from the check above, which used to end "...so all of them can be
    // placed on the same scale".
    buildComparabilityCheck(leaderboard),
    ...buildDeclinedRowsCheck({ leaderboard, rowsWithoutVerdict }),
    buildSettledCheck(leaderboard),
    ...buildMarginsCheck(leaderboard),
    // How much of the order this run actually established. Deliberately a
    // count of what happened rather than an estimate of what more rows would
    // buy: a required-sample figure is a power calculation over an effect
    // size drawn from this same thin data, so "20 more will settle it" is a
    // promise the run cannot keep.
    buildResolutionCheck(sampleAdequacy),
    buildVerbosityCheck(verbosity),
    buildJudgeIndependenceCheck(judgeIndependence, variantNames, leaderId),
  ];
};

/**
 * The count above is several 95% tests reported as one number, so it is not a joint
 * guarantee.
 */
const multiplicityNote = (adequacy: SampleAdequacy): string => {
  const rate = adequacy.familyWiseFalsePositiveRate;
  if (rate === null || adequacy.separatedPairs === 0) return "";
  return ` Each pair is judged on its own at 95%, so across ${adequacy.totalPairs} pairs there is roughly a ${Math.round(
    rate * 100,
  )}% chance at least one of them separated by luck.`;
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
      detail: `None of the ${totalPairs} variant pairs were separated — for every pair, the gap between the two scores is smaller than the uncertainty in that gap. ${comparisonCount} comparisons was not enough to order these variants.`,
    };
  }

  return {
    label: "How much this run settled",
    tone: separatedPairs === totalPairs ? "ok" : "note",
    detail:
      (separatedPairs === totalPairs
        ? `All ${totalPairs} variant pairs were separated, so the run establishes a full order. Based on ${comparisonCount} comparisons.`
        : `${separatedPairs} of ${totalPairs} variant pairs were separated; for the rest, the gap between them is smaller than the uncertainty in that gap. Based on ${comparisonCount} comparisons.`) +
      multiplicityNote(adequacy),
  };
};

/**
 * Verbosity bias: judges score longer answers higher regardless of quality. Reported as
 * a ratio and never as a failure — for plenty of tasks the longer answer genuinely is
 * the better one, and the reader is the one who knows which task this is.
 */
const buildVerbosityCheck = (verbosity: VerbosityProfile): TrustCheck => {
  const { leaderRatio } = verbosity;

  if (leaderRatio === null) {
    // Two different reasons produce a null ratio, and saying the wrong one is
    // worse than saying neither: telling a reader their outputs were not
    // recorded, while those outputs are on screen, sends them to debug an
    // ingestion problem that does not exist.
    return {
      label: "Answer length",
      tone: "note",
      detail:
        verbosity.leaderId === null
          ? "This run has no single leader, so there is nothing to compare answer lengths against."
          : "Not enough output text was recorded to compare how long each variant's answers were.",
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
 * Self-preference: a judge rates its own model family's output higher. The judge model
 * is read off the run, not off the evaluator's current config, so editing the evaluator
 * later cannot retroactively change what this says about an old run.
 */
const buildJudgeIndependenceCheck = (
  independence: JudgeIndependence,
  variantNames: Record<string, string>,
  leaderId: string | null,
): TrustCheck => {
  const { judgeModel, judgeFamily, sharedFamilyVariantIds } = independence;

  if (!judgeModel) {
    return {
      label: "Judge independence",
      tone: "note",
      detail:
        "This run did not record which model judged it, so whether the judge shares a model family with a candidate cannot be checked.",
    };
  }

  // A model id `modelFamily` cannot parse yields no family, which makes
  // `sharedFamilyVariantIds` empty for the same reason a genuinely
  // independent judge does — and the branch below would then report
  // independence it never established. Same failure as an empty leaderboard
  // reporting a converged fit: green because nothing was checked.
  if (judgeFamily === null) {
    return {
      label: "Judge independence",
      tone: "note",
      detail: `The judge is recorded as ${judgeModel}, which does not name a provider, so whether it shares a model family with a candidate cannot be checked.`,
    };
  }

  if (sharedFamilyVariantIds.length > 0) {
    const names = joinNames(sharedFamilyVariantIds.map((id) => nameOf(id, variantNames)));
    // "discount that variant's lead" was said whoever the shared variant was,
    // including one sitting at the bottom of the table with no lead to
    // discount. Self-preference inflates a score wherever it sits; only when
    // the affected variant is on top is there a lead in the first place.
    const affectsLeader = leaderId !== null && sharedFamilyVariantIds.includes(leaderId);
    return {
      label: "Judge independence",
      tone: "warn",
      detail: `The judge (${judgeModel}) shares a model family with ${names}. Judges tend to rate their own family's output higher, so ${
        affectsLeader
          ? "discount that variant's lead accordingly."
          : "that variant's score may be flattered — which matters most if it is close to the one you are about to ship."
      }`,
    };
  }

  return {
    label: "Judge independence",
    tone: "ok",
    detail: `Judged by ${judgeModel}, which shares a model family with none of the candidates.`,
  };
};

const TONE_STYLES: Record<TrustTone, { color: string; icon: typeof LuCheck }> = {
  ok: { color: "green.fg", icon: LuCheck },
  warn: { color: "orange.fg", icon: LuTriangleAlert },
  note: { color: "fg.muted", icon: LuInfo },
};

export function LeaderboardTrustPanel(props: LeaderboardTrustPanelProps) {
  const checks = buildTrustChecks(props);

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" color="fg.muted">
        {/*
          Not "head-to-head": a Comparison judges the whole field in one
          verdict, so with four variants these are four-way calls, not pairs.
          The pairwise matchups are derived from them and counted separately.
        */}
        Based on {props.leaderboard.comparisonCount} comparisons the judge resolved.
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
