/**
 * buildLeaderboardLangyPrompt — the question handed to Langy when a reader
 * asks for a comparison result to be explained.
 *
 * Written first-person, because `askLangy` drops it into the composer as
 * the reader's own message: it lands in their chat history and they will
 * read it back. It has to be a question a person would plausibly type, not
 * a system prompt leaking into a conversation.
 *
 * It carries the numbers the page already computed rather than pointing
 * Langy at the run and letting it work them out. Langy could go and
 * re-derive a ranking, and a second ranking that disagrees with the one on
 * screen is worse than no explanation at all — so the conclusion is stated
 * up front and Langy is asked to explain it, not to reach it.
 *
 * Deliberately no instruction to "be concise" or "use plain language" in a
 * voice the reader would not use themselves. Langy is a conversation: if
 * the answer is too long or too technical, they can just say so.
 */

import type { BTLeaderboard } from "./computeBTLeaderboard";
import { areDistinguishable } from "./scoreSeparation";
import type { SampleAdequacy } from "./computeSampleAdequacy";
import type { VariantMetrics } from "./computeVariantMetrics";
import type { LeaderboardHeadline } from "./formatLeaderboardHeadline";
import type { TrustCheck } from "./LeaderboardTrustPanel";

const formatNumber = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(0)
    : "unknown";

const formatCost = (value: number | null | undefined): string =>
  typeof value !== "number" || !Number.isFinite(value)
    ? "unknown"
    : value >= 0.01
      ? `$${value.toFixed(2)}`
      : `$${value.toFixed(4)}`;

export const buildLeaderboardLangyPrompt = ({
  comparisonName,
  headline,
  leaderboard,
  sampleAdequacy,
  variantMetrics,
  variantNames,
  checks,
}: {
  comparisonName: string;
  headline: LeaderboardHeadline;
  leaderboard: BTLeaderboard;
  sampleAdequacy: SampleAdequacy;
  variantMetrics: Record<string, VariantMetrics>;
  variantNames: Record<string, string>;
  checks: TrustCheck[];
}): string => {
  const nameOf = (variantId: string) => variantNames[variantId] ?? variantId;
  const rows = leaderboard.entries
    .map((entry) => {
      const name = variantNames[entry.variantId] ?? entry.variantId;
      const range = entry.scoreCI
        ? `${formatNumber(entry.scoreCI[0])} to ${formatNumber(entry.scoreCI[1])}`
        : "no range";
      const winRate =
        entry.winRate === null ? "unknown" : `${Math.round(entry.winRate * 100)}%`;
      const cost = formatCost(variantMetrics[entry.variantId]?.costStats?.avg);
      const latency = formatNumber(
        variantMetrics[entry.variantId]?.durationStats?.avg,
      );
      return (
        `- ${name}: score ${formatNumber(entry.score)} (plausible range ${range}), ` +
        `won ${winRate} of ${entry.matchups} comparisons, ` +
        `${cost} and ${latency}ms per row` +
        (entry.degenerate ? " — never won or never lost, so it can't be ranked" : "")
      );
    })
    .join("\n");

  const checkLines = checks
    .map((check) => `- ${check.label}: ${check.detail}`)
    .join("\n");

  // Which pairs this run actually separated, computed by the same function
  // the panels use rather than restated as a rule for Langy to apply.
  const rankable = leaderboard.entries.filter((entry) => !entry.degenerate);
  const separationPairs: string[] = [];
  for (let i = 0; i < rankable.length; i++) {
    for (let j = i + 1; j < rankable.length; j++) {
      const a = rankable[i]!;
      const b = rankable[j]!;
      const separated = areDistinguishable({
        a,
        b,
        differenceCI: leaderboard.scoreDifferenceCI,
      });
      separationPairs.push(
        `- ${nameOf(a.variantId)} vs ${nameOf(b.variantId)}: ${
          separated
            ? "separated — this run does tell them apart"
            : "NOT separated — please don't describe either as better than the other"
        }`,
      );
    }
  }
  const separationLines = separationPairs.length
    ? `Which pairs this run separated:\n${separationPairs.join("\n")}`
    : "There are no pairs to separate.";

  return [
    `Explain my "${comparisonName}" experiment result to me, and tell me what to do about it.`,
    "",
    "LangWatch already worked out the ranking and the conclusion — please explain THAT rather than re-ranking the variants yourself, because a second answer that disagrees with the one on my screen is not useful to me.",
    "",
    `The conclusion on screen: ${headline.heading}. ${headline.detail}`,
    "",
    "The ranking (Bradley-Terry, over the matchups implied by each verdict):",
    rows || "- (nothing rankable)",
    "",
    `Confidence: ${sampleAdequacy.separatedPairs} of ${sampleAdequacy.totalPairs} variant pairs were separated, from ${sampleAdequacy.comparisonCount} comparisons.`,
    // The pairs are listed rather than left to be inferred from the ranges
    // above. Whether two variants differ is decided on the interval of the
    // DIFFERENCE between their scores, which is tighter than either range
    // because both move together across resamples — so two variants whose
    // printed ranges overlap may well be separated. An earlier version of
    // this prompt told Langy the opposite ("ranges that overlap are not
    // distinguishable"), which was true of the old test and would now have
    // Langy contradicting the panel on the same screen.
    separationLines,
    "Please treat that list as the answer on which variants differ, rather than comparing the printed ranges yourself.",
    "",
    "Checks that were run:",
    checkLines || "- (none)",
    "",
    "What does this mean for which variant I should ship, and is there anything here I should be worried about?",
  ].join("\n");
};
