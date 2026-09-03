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
} from "./batch-evaluation-results.verdict";

export type LeaderboardHeadline = {
  /** Sentence fragment naming the action, e.g. "Ship support-warm". */
  heading: string;
  /** One sentence of justification. */
  detail: string;
  /** Drives the callout colour; also tells a caller whether to celebrate. */
  tone: "positive" | "caution" | "neutral";
};

const nameOf = (variantId: string, variantNames: Record<string, string>): string =>
  variantNames[variantId] ?? variantId;

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
        "This run has not resolved enough comparisons to place the variants in an order. Run it over more rows.",
    };
  }

  if (verdict.kind === "clear-winner") {
    return {
      tone: "positive",
      heading: `Ship ${nameOf(verdict.leaderId!, variantNames)}`,
      // Not "by more than the run's own margin of error". Separation is
      // decided on the uncertainty of the GAP between two scores, which is
      // tighter than either printed margin because both scores move together
      // across resamples. A legitimate clear winner can therefore fail to
      // clear those margins, and this sentence was asserting it had — a
      // stronger claim than the one actually tested, in the heading a reader
      // acts on.
      detail:
        "The run separates it from every other variant: the gap to each of them is bigger than the uncertainty in that gap, so the ranking is not a coin flip.",
    };
  }

  const tiedNames = joinNames(verdict.tiedIds.map((id) => nameOf(id, variantNames)));

  // Deliberately NOT phrased as a tie, and deliberately offered no cheaper
  // alternative. A tie says the run looked and found no difference, which
  // makes cost the right tie-breaker. This says the run never looked — so
  // picking the cheaper one could be shipping the worse one, and the reader
  // has to be told the difference.
  if (verdict.kind === "not-comparable") {
    return {
      tone: "caution",
      heading: "Not enough overlap to rank these",
      detail: `${tiedNames} were never put up against each other in this run, directly or through a shared opponent, so it cannot say which is better. Re-run so every variant answers the same rows.`,
    };
  }

  // A tie plus a price difference is not an inconclusive result — it is a
  // decision, just made on cost instead of on quality.
  if (cheaperAlternative) {
    // Never round to 100: that reads as free, and the cheapest variant in a
    // real run costs something. A variant at $0.00004 against $0.012 is a
    // 99.7% saving, not a giveaway.
    const percent = Math.min(99, Math.round(cheaperAlternative.savingRatio * 100));
    const name = nameOf(cheaperAlternative.variantId, variantNames);
    const others =
      verdict.tiedIds.length > 2 ? "the others it ties with" : "the one it ties with";
    const price = `${formatCost(cheaperAlternative.cost)} vs ${formatCost(
      cheaperAlternative.dearestCost,
    )} per row.`;

    // The leader being the cheapest is the strongest result this chart can
    // produce, and it used to render as a bare "too close to call" — the
    // vaguest phrasing for the least ambiguous outcome.
    return cheaperAlternative.isLeader
      ? {
          tone: "positive",
          heading: `Ship ${name} — top of the ranking and ${percent}% cheaper`,
          detail: `${tiedNames} score too closely for this run to separate them on quality, and ${name} is the cheapest of them: ${price}`,
        }
      : {
          tone: "positive",
          heading: `Ship ${name} — not separated on quality, ${percent}% cheaper`,
          detail: `${tiedNames} score too closely for this run to separate them, so quality is not the deciding factor here. ${name} costs less than ${others}: ${price}`,
        };
  }

  return {
    tone: "caution",
    heading: "Too close to call",
    detail: `${tiedNames} are too close for this run to tell apart, so it does not establish a winner between them. Decide on cost, latency, or simplicity instead — or run more rows to separate them.`,
  };
};
