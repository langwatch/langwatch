/**
 * computeLeaderboardVerdict — turns a Bradley-Terry leaderboard into the answer a
 * reader actually came for: which variant should I ship?
 */

import type {
  BTLeaderboard,
  BTLeaderboardEntry,
} from "../../model/batch-evaluation-results.bt-leaderboard";
import { isIncomparable } from "../../model/batch-evaluation-results.comparability";
import { MIN_PRICED_ROWS, type VariantMetrics } from "./batch-evaluation-results.variant-metrics";
import { areDistinguishable } from "../../model/batch-evaluation-results.score-separation";

export type LeaderboardVerdict = {
  /**
   * `clear-winner` — one variant beats every other beyond overlap. `tie-at-top` — two
   * or more are indistinguishable at the top. `not-comparable` — the top group spans
   * variants that never met, so the run is not entitled to order them at all.
   */
  kind: "clear-winner" | "tie-at-top" | "not-comparable" | "no-signal";
  /** Highest-scoring non-degenerate variant, when one exists. */
  leaderId: string | null;
  /**
   * The leader plus every variant it cannot be separated from, in rank
   * order. Length 1 exactly when `kind` is `clear-winner`.
   */
  tiedIds: string[];
};

export const computeLeaderboardVerdict = (leaderboard: BTLeaderboard): LeaderboardVerdict => {
  const differenceCI = leaderboard.scoreDifferenceCI;
  // Degenerate variants (no wins or no losses at all) have no meaningful
  // MLE score, so they cannot be crowned or used to unseat anyone.
  const ranked = leaderboard.entries.filter((entry) => !entry.isDegenerate);

  if (leaderboard.comparisonCount === 0 || ranked.length === 0) {
    return { kind: "no-signal", leaderId: null, tiedIds: [] };
  }

  // Nothing to crown when the field collapsed to a single rankable variant.
  if (ranked.length === 1) {
    return { kind: "no-signal", leaderId: null, tiedIds: [] };
  }

  const leader = ranked[0]!;

  // The tie set has to be MUTUALLY indistinguishable, not merely indistinguishable from
  // the leader.
  const comparability = leaderboard.comparability;
  const tied: BTLeaderboardEntry[] = [leader];
  for (const entry of ranked.slice(1)) {
    if (
      tied.every(
        (member) =>
          !areDistinguishable({
            a: member,
            b: entry,
            differenceCI,
            comparability,
          }),
      )
    ) {
      tied.push(entry);
    }
  }

  // A clear winner is safe by construction: a variant this run cannot compare
  // to the leader is never separable from it, so it joins the clique below and
  // the field never reaches length 1. The crowning here therefore only happens
  // over variants the leader actually faced.
  if (tied.length === 1) {
    return {
      kind: "clear-winner",
      leaderId: leader.variantId,
      tiedIds: [leader.variantId],
    };
  }

  // "We compared them and they are close" and "we could not compare them" are different
  // findings, and only the first one licenses deciding on cost.
  const spansBreak = tied.some((member, i) =>
    tied.slice(i + 1).some((other) =>
      isIncomparable({
        comparability,
        a: member.variantId,
        b: other.variantId,
      }),
    ),
  );

  return {
    kind: spansBreak ? "not-comparable" : "tie-at-top",
    leaderId: leader.variantId,
    tiedIds: tied.map((entry) => entry.variantId),
  };
};

export type CheaperAlternative = {
  /** Cheapest variant among the tied set. May be the top-ranked one. */
  variantId: string;
  /** Mean cost of the recommended variant. */
  cost: number;
  /**
   * Cost of what the reader would otherwise ship: the leader, or — when the
   * cheapest IS the leader — the dearest variant tied with it.
   */
  dearestCost: number;
  /** e.g. 0.6 means the recommendation costs 60% less than that baseline. */
  savingRatio: number;
  /** True when the cheapest tied variant also tops the ranking. */
  isLeader: boolean;
};

/**
 * Whether a paired cost interval establishes a real saving.
 */
const pairedSavingIsEstablished = (interval: [number, number] | undefined): boolean => {
  if (!interval) return true;
  if (!interval.every((bound) => Number.isFinite(bound))) return false;
  // cheapest minus baseline: a real saving sits entirely below zero.
  return interval[1] < 0;
};

/**
 * Among variants the run cannot tell apart, the cheapest one.
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

  // A mean over one priced row is not a cost. Rows are priced independently,
  // so a run can record cost on a handful and leave the rest null — and the
  // old code read `avg` without ever asking how many rows it came from, then
  // printed the result as "$X per row". Require the same floor a matchup count
  // gets before it is allowed to carry a recommendation.
  const pricedRowsOf = (variantId: string): number =>
    variantMetrics[variantId]?.costStats?.count ?? 0;

  const priced = verdict.tiedIds
    .map((variantId) => ({
      variantId,
      cost: costOf(variantId),
      rows: pricedRowsOf(variantId),
    }))
    .filter(
      (entry): entry is { variantId: string; cost: number; rows: number } =>
        entry.cost !== null && Number.isFinite(entry.cost) && entry.rows >= MIN_PRICED_ROWS,
    );
  if (priced.length < 2) return null;

  const cheapest = priced.reduce((a, b) => (b.cost < a.cost ? b : a));

  // What the reader would otherwise have shipped is the BASELINE.
  const baseline =
    cheapest.variantId === verdict.leaderId
      ? priced.reduce((a, b) => (b.cost > a.cost ? b : a))
      : priced.find((entry) => entry.variantId === verdict.leaderId);
  if (!baseline || baseline.cost <= 0) return null;

  const savingRatio = (baseline.cost - cheapest.cost) / baseline.cost;
  if (savingRatio < minSaving) return null;

  // The gap also has to be one this run can actually see.
  if (
    !pairedSavingIsEstablished(
      variantMetrics[cheapest.variantId]?.costDifferenceCI?.[baseline.variantId],
    )
  ) {
    return null;
  }

  return {
    variantId: cheapest.variantId,
    cost: cheapest.cost,
    dearestCost: baseline.cost,
    savingRatio,
    isLeader: cheapest.variantId === verdict.leaderId,
  };
};
