/**
 * formatLeaderboardHeadline — the one sentence a reader who reads nothing
 * else should leave with.
 *
 * Every input to this sentence is already computed deterministically: the
 * verdict, the tie set, the cost gap. Generating the sentence with a model
 * would add fluency and nothing else, while introducing the one component
 * of this feature capable of being wrong — and being wrong in fluent
 * English, which is harder to catch than being wrong in a chart. The whole
 * point of the leaderboard is that it refuses to name a winner the data
 * cannot support; a summariser that rounds a tie up to a winner would undo
 * that in a single line.
 *
 * So it lives here, in code, where it is a pure function of the numbers and
 * is covered by tests. The optional written explanation sits BELOW this
 * sentence and cannot replace it.
 */

import type {
  CheaperAlternative,
  LeaderboardVerdict,
} from "./computeLeaderboardVerdict";

export type LeaderboardHeadline = {
  /** Sentence fragment naming the action, e.g. "Ship support-warm". */
  heading: string;
  /** One sentence of justification. */
  detail: string;
  /** Drives the callout colour; also tells a caller whether to celebrate. */
  tone: "positive" | "caution" | "neutral";
};

const nameOf = (
  variantId: string,
  variantNames: Record<string, string>,
): string => variantNames[variantId] ?? variantId;

export const formatCost = (value: number): string =>
  value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;

/** "a and b" for two, "a, b and c" for more — reads as prose, not a list. */
const joinNames = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

export const formatLeaderboardHeadline = ({
  verdict,
  cheaperAlternative,
  variantNames,
}: {
  verdict: LeaderboardVerdict;
  cheaperAlternative: CheaperAlternative | null;
  variantNames: Record<string, string>;
}): LeaderboardHeadline => {
  if (verdict.kind === "no-signal") {
    return {
      tone: "neutral",
      heading: "No ranking yet",
      detail:
        "This run has not resolved enough head-to-head comparisons to place the variants in an order. Run it over more rows.",
    };
  }

  if (verdict.kind === "clear-winner") {
    return {
      tone: "positive",
      heading: `Ship ${nameOf(verdict.leaderId!, variantNames)}`,
      detail:
        "It scores above every other variant by more than the run's own margin of error, so the ranking is not a coin flip.",
    };
  }

  const tiedNames = joinNames(
    verdict.tiedIds.map((id) => nameOf(id, variantNames)),
  );

  // A tie plus a price difference is not an inconclusive result — it is a
  // decision, just made on cost instead of on quality.
  if (cheaperAlternative) {
    return {
      tone: "positive",
      heading: `Ship ${nameOf(cheaperAlternative.variantId, variantNames)} — same quality, ${Math.round(
        cheaperAlternative.savingRatio * 100,
      )}% cheaper`,
      detail: `${tiedNames} score too closely for this run to separate them, so quality is not the deciding factor here. Cost is: ${formatCost(
        cheaperAlternative.cost,
      )} vs ${formatCost(cheaperAlternative.leaderCost)} per row.`,
    };
  }

  return {
    tone: "caution",
    heading: "Too close to call",
    detail: `${tiedNames} score within each other's margin of error, so this run does not establish a winner between them. Decide on cost, latency, or simplicity instead — or run more rows to separate them.`,
  };
};
