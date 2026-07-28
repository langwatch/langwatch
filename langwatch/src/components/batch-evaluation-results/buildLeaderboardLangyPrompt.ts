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
    `Confidence: ${sampleAdequacy.separatedPairs} of ${sampleAdequacy.totalPairs} variant pairs were separated beyond their margins of error, from ${sampleAdequacy.comparisonCount} comparisons. Variants whose plausible ranges overlap are NOT distinguishable — please don't describe one of those as better than the other.`,
    "",
    "Checks that were run:",
    checkLines || "- (none)",
    "",
    "What does this mean for which variant I should ship, and is there anything here I should be worried about?",
  ].join("\n");
};
