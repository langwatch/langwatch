/**
 * computeLeaderboardVerdict — turns a Bradley-Terry leaderboard into the
 * answer a reader actually came for: which variant should I ship?
 *
 * A ranked table cannot answer that on its own. "1.42 ± 0.18" beside
 * "1.31 ± 0.22" LOOKS like a winner and a runner-up, but those intervals
 * overlap heavily — the run does not distinguish them, and shipping the
 * top row would be reading noise as a result. Deciding that requires
 * comparing intervals, which is exactly the arithmetic a reader skips.
 *
 * So the leader is reported as a genuine winner only when nothing else is
 * statistically indistinguishable from it. Otherwise the honest output is
 * "these are tied", which is a real and useful answer — it means the
 * difference is not where the decision should be made, and something else
 * (cost, latency, simplicity) should break the tie instead.
 */

import type { BTLeaderboard, BTLeaderboardEntry } from "./computeBTLeaderboard";
import type { VariantMetrics } from "./computeVariantMetrics";

export type LeaderboardVerdict = {
  /**
   * `clear-winner` — one variant beats every other beyond overlap.
   * `tie-at-top`   — two or more are indistinguishable at the top.
   * `no-signal`    — not enough resolved comparisons to say anything.
   */
  kind: "clear-winner" | "tie-at-top" | "no-signal";
  /** Highest-scoring non-degenerate variant, when one exists. */
  leaderId: string | null;
  /**
   * The leader plus every variant it cannot be separated from, in rank
   * order. Length 1 exactly when `kind` is `clear-winner`.
   */
  tiedIds: string[];
};

/** Two intervals overlap unless one ends strictly before the other starts. */
const intervalsOverlap = (
  a: [number, number],
  b: [number, number],
): boolean => a[0] <= b[1] && b[0] <= a[1];

/**
 * Whether the run separates these two variants.
 *
 * A missing interval means the bootstrap was disabled or the sample was too
 * small to produce one. That is an absence of evidence, not evidence of a
 * difference, so it counts as "cannot separate" — the conservative
 * direction, and the one that avoids inventing a winner from thin data.
 */
const areDistinguishable = (
  a: BTLeaderboardEntry,
  b: BTLeaderboardEntry,
): boolean => {
  if (!a.scoreCI || !b.scoreCI) return false;
  // A non-finite bound is not evidence of a difference, and NaN in particular
  // would masquerade as one: every comparison against NaN is false, so
  // `intervalsOverlap` returns false and the negation reads "distinguishable".
  // That produced a `clear-winner` on the same leaderboard where
  // computeSampleAdequacy — which has always checked this — reported zero
  // separated pairs, so the two panels contradicted each other on screen.
  if (
    ![...a.scoreCI, ...b.scoreCI].every((bound) => Number.isFinite(bound))
  ) {
    return false;
  }
  return !intervalsOverlap(a.scoreCI, b.scoreCI);
};

export const computeLeaderboardVerdict = (
  leaderboard: BTLeaderboard,
): LeaderboardVerdict => {
  // Degenerate variants (no wins or no losses at all) have no meaningful
  // MLE score, so they cannot be crowned or used to unseat anyone.
  const ranked = leaderboard.entries.filter((entry) => !entry.degenerate);

  if (leaderboard.comparisonCount === 0 || ranked.length === 0) {
    return { kind: "no-signal", leaderId: null, tiedIds: [] };
  }

  // Nothing to crown when the field collapsed to a single rankable variant.
  //
  // `ranked` has already dropped the degenerates, and a variant is degenerate
  // precisely because it swept or was swept — which is to say, because it beat
  // or lost to the survivor every single time. Falling through to
  // `clear-winner` here read that as "nobody could be separated from the
  // leader" and recommended shipping it. On a straight a > b > c run that
  // named b: the variant that lost every match it played against a, while the
  // table above showed a at a 100% win rate.
  if (ranked.length === 1) {
    return { kind: "no-signal", leaderId: null, tiedIds: [] };
  }

  const leader = ranked[0]!;

  // The tie set has to be MUTUALLY indistinguishable, not merely
  // indistinguishable from the leader.
  //
  // Filtering against the leader alone builds a set that can contain two
  // variants this very run separated: L overlaps M, L overlaps C, and M and C
  // do not overlap each other. The headline then says "L, M and C score too
  // closely to separate" — contradicting the trust panel beside it, which
  // counts that M/C pair as separated — and, because the set is offered as
  // interchangeable-on-quality, invites shipping C on cost when the same run
  // showed M to be better.
  //
  // Grown greedily in rank order: a candidate joins only if it is
  // indistinguishable from everything already in the set. That keeps the
  // leader in by construction and yields the top clique in score order.
  const tied: BTLeaderboardEntry[] = [leader];
  for (const entry of ranked.slice(1)) {
    if (tied.every((member) => !areDistinguishable(member, entry))) {
      tied.push(entry);
    }
  }

  if (tied.length === 1) {
    return {
      kind: "clear-winner",
      leaderId: leader.variantId,
      tiedIds: [leader.variantId],
    };
  }

  return {
    kind: "tie-at-top",
    leaderId: leader.variantId,
    tiedIds: tied.map((entry) => entry.variantId),
  };
};

export type CheaperAlternative = {
  /** Cheapest variant among the tied set. May be the top-ranked one. */
  variantId: string;
  /** Mean cost of the recommended variant. */
  cost: number;
  /** Mean cost of the dearest variant it is tied with. */
  dearestCost: number;
  /** e.g. 0.6 means the recommendation costs 60% less than the dearest. */
  savingRatio: number;
  /** True when the cheapest tied variant also tops the ranking. */
  isLeader: boolean;
};

/**
 * Among variants the run cannot tell apart, the cheapest one.
 *
 * This is the payoff of reporting ties honestly. If two variants are
 * statistically indistinguishable and one costs half as much, the ranking
 * is not the decision — the price is.
 *
 * The cheapest tied variant is the answer whether or not it happens to be
 * the top row. An earlier version only looked BELOW the leader, so a run
 * where the leader was already the cheapest — the clearest possible
 * outcome, top of the ranking and cheapest to run — fell through to a bare
 * "too close to call" and threw the decision away. Cost is therefore
 * measured against the dearest variant in the tie rather than against the
 * leader, which is the same number whenever the leader is the dearest and
 * a true one in every other arrangement.
 *
 * Returns null when costs are unknown, when the spread is inside the noise
 * floor, or when there is nothing to break a tie between.
 */
export const findCheaperTiedAlternative = ({
  verdict,
  variantMetrics,
  minSaving = 0.1,
}: {
  verdict: LeaderboardVerdict;
  variantMetrics: Record<string, VariantMetrics>;
  /** Ignore differences below this share — noise, not a reason to switch. */
  minSaving?: number;
}): CheaperAlternative | null => {
  if (verdict.kind !== "tie-at-top" || !verdict.leaderId) return null;

  // `avg` rather than `median` to stay consistent with how cost is plotted
  // elsewhere in this feature, and because a variant whose occasional row is
  // expensive genuinely does cost more to run.
  const costOf = (variantId: string): number | null =>
    variantMetrics[variantId]?.costStats?.avg ?? null;

  const priced = verdict.tiedIds
    .map((variantId) => ({ variantId, cost: costOf(variantId) }))
    .filter((entry): entry is { variantId: string; cost: number } =>
      entry.cost !== null && Number.isFinite(entry.cost),
    );
  if (priced.length < 2) return null;

  const cheapest = priced.reduce((a, b) => (b.cost < a.cost ? b : a));
  const dearest = priced.reduce((a, b) => (b.cost > a.cost ? b : a));
  if (dearest.cost <= 0) return null;

  const savingRatio = (dearest.cost - cheapest.cost) / dearest.cost;
  if (savingRatio < minSaving) return null;

  return {
    variantId: cheapest.variantId,
    cost: cheapest.cost,
    dearestCost: dearest.cost,
    savingRatio,
    isLeader: cheapest.variantId === verdict.leaderId,
  };
};
