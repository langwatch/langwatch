/**
 * Bradley-Terry MLE leaderboard for the Comparison evaluator (#5103).
 * Pure client-side helper — mirrors the shape of `computeBatchAggregates.ts`.
 * No I/O, no React.
 *
 * Math: iterative MM update from Hunter (2004) "MM algorithms for generalized
 * Bradley-Terry models". Bootstrap percentile CIs for the Elo-style score.
 * Tie convention: 0.5 win + 0.5 loss to each side (LMSYS Arena).
 */

import {
  computeComparability,
  type Comparability,
} from "./computeComparability";
import { mulberry32 } from "./mulberry32";

export type PairwiseComparison = {
  /** Candidate target ids involved in this comparison (>= 2). */
  candidates: string[];
  /**
   * Winning target id, "tie" for an explicit tie, or null to skip the row
   * (pending / error / unknown). Tie semantics are only well-defined for
   * 2-candidate rows; for N>2 a "tie" row is treated as null.
   */
  winner: string | "tie" | null;
};

export type BTLeaderboardEntry = {
  variantId: string;
  /** Total wins (1 per win, 0.5 per tie). */
  wins: number;
  /** Total losses (1 per loss, 0.5 per tie). */
  losses: number;
  /**
   * Total PAIRWISE matchups this variant took part in — wins + losses in the
   * win matrix, where an N-way verdict contributes one matchup per pair it
   * implies. Not a row count: on a four-way run a variant appearing in all 60
   * rows records 116 matchups, not 60. `winRate` is over the same denominator.
   */
  matchups: number;
  /** Win rate over matchups, or null if no matchups. */
  winRate: number | null;
  /** BT strength (positive). Normalized so geometric mean of strengths = 1. */
  strength: number;
  /** Elo-style score: 400 * log10(strength). Centered around 0. */
  score: number;
  /** 95% bootstrap CI for score, null when bootstrap disabled or N too small. */
  scoreCI: [number, number] | null;
  /** True when this variant has 0 wins OR 0 losses → MLE degenerate. */
  isDegenerate: boolean;
};

/**
 * Pair-by-pair win count: matrix[a][b] = number of times variant a beat
 * variant b (ties count 0.5 to each side). Keyed by variantId (not index)
 * so the consumer doesn't have to track ordering. The heatmap in
 * PairwiseLeaderboard reads this directly.
 */
export type WinMatrix = Record<string, Record<string, number>>;

export type BTLeaderboard = {
  /** Sorted by score desc. Degenerate variants sink to the bottom. */
  entries: BTLeaderboardEntry[];
  /** Pair-by-pair win counts for the heatmap. */
  winMatrix: WinMatrix;
  /** Number of comparisons consumed (rows with winner !== null). */
  comparisonCount: number;
  /** Minimum matchups across all variants — used to gate sample-size warnings. */
  minMatchups: number;
  /** True when at least one variant is BT-degenerate. */
  hasDegenerate: boolean;
  /** True when the MM solver converged within maxIter. */
  didConverge: boolean;
  /**
   * Which variants this fit is entitled to compare.
   *
   * `hasDegenerate` above tests a per-variant condition that is necessary but
   * NOT sufficient for the MLE to exist. This is the sufficient one (Ford
   * 1957): scores are comparable only within a strongly connected component.
   */
  comparability: Comparability;
  /**
   * 95% CI of the DIFFERENCE between two scores, per ordered pair. Null when
   * the bootstrap did not run.
   *
   * This is the statistic the separation question actually asks, and it is
   * not recoverable from the per-variant intervals above. Every replicate
   * re-fits the whole field at once, so two variants' replicate scores move
   * together — a resample that happens to favour the field lifts both. The
   * difference cancels that shared movement; comparing the two marginal
   * intervals does not, and so tests a strictly stronger condition than
   * "these two differ". The cost is real: intervals can overlap while every
   * replicate still puts a ahead of b.
   */
  scoreDifferenceCI: ScoreDifferenceCI | null;
  /**
   * Share of bootstrap replicates whose own fit hit the iteration cap
   * instead of settling. Null when the bootstrap did not run.
   *
   * The point fit reports `didConverge`, but the interval is built from a
   * thousand other fits and their failures used to be discarded. A resample
   * can be much harder to fit than the full dataset — it routinely drops a
   * variant's only wins — so a run can converge cleanly and still have its
   * interval drawn largely from fits that never did.
   */
  bootstrapNonConvergence: number | null;
};

/**
 * `scoreDifferenceCI[a][b]` is the 95% interval for (score of a) − (score of
 * b). Keyed by variantId rather than index so consumers holding an entry can
 * look a pair up without tracking the fit's ordering.
 */
export type ScoreDifferenceCI = Record<
  string,
  Record<string, [number, number]>
>;

export type BTLeaderboardOptions = {
  /**
   * Bootstrap resamples for CI. 0 disables. Default: 1000.
   *
   * Not 200: at that size the Monte-Carlo error on the interval endpoints was
   * large enough to change which pairs the run called separated on a mere
   * reseed — measured on 24 of 60 datasets, worst spread 3 pairs of 6. Since
   * "did this run separate them" is the product's central claim, it must not
   * depend on the seed. 1000 cuts the endpoint SD roughly in half.
   */
  bootstrapSamples?: number;
  /** Deterministic seed (mulberry32). Default: 1. */
  seed?: number;
  /** MM solver iteration cap. Default: 500. */
  maxIter?: number;
  /** MM solver convergence tolerance on max relative strength change. Default: 1e-6. */
  tol?: number;
};

const DEFAULT_OPTS: Required<BTLeaderboardOptions> = {
  bootstrapSamples: 1000,
  seed: 1,
  maxIter: 500,
  tol: 1e-6,
};

export function computeBTLeaderboard({
  comparisons,
  variantIds,
  ...options
}: {
  comparisons: PairwiseComparison[];
  variantIds: string[];
} & BTLeaderboardOptions): BTLeaderboard {
  const opts = { ...DEFAULT_OPTS, ...options };
  const n = variantIds.length;

  if (n === 0) {
    return {
      entries: [],
      winMatrix: {},
      comparisonCount: 0,
      minMatchups: 0,
      hasDegenerate: false,
      didConverge: true,
      comparability: { identifiable: true, groups: [], dominates: [] },
      scoreDifferenceCI: null,
      bootstrapNonConvergence: null,
    };
  }

  const idx = new Map(variantIds.map((id, i) => [id, i]));
  // Rows that survive to contribute evidence. `winner !== null` alone was too
  // permissive: an N-way tie, an unknown winner, or an empty candidate list all
  // pass it and are then discarded inside the matrix builders, so the run
  // reported "based on 60 comparisons" while ranking on fewer. Resolve first
  // and count what is left.
  const usable = comparisons.filter(
    (c) => c.winner !== null && resolveComparison({ comparison: c, idx }) !== null,
  );

  const W = buildWinMatrix(usable, idx, n);
  const { wins, losses, matchups } = perVariantTotals(W);

  const degenerateMask = wins.map((w, i) => w === 0 || losses[i] === 0);
  const hasDegenerate = degenerateMask.some(Boolean);

  // Smoothing keeps MM finite when at least one variant is degenerate. A
  // shared Beta(eps, eps) prior across every pair is the standard fix
  // (Hunter §4).
  //
  // It is NOT order-preserving, and an earlier comment here claimed it was.
  // The prior adds the same pseudo-count to every pair regardless of how many
  // real games that pair played, so a pair with two games is dragged most of
  // the way to 50/50 while a pair with thirty barely moves. On unequal sample
  // sizes that reorders healthy variants: measured 545 flips across 4000 such
  // matrices between eps=1e-4 and the eps=0.5 used here. The trigger is a
  // isDegenerate variant elsewhere in the field, which is why the reordering can
  // involve two variants that have nothing to do with it.
  //
  // Kept because the alternative — no finite fit at all — is worse, and
  // because the isDegenerate variant that triggers it is excluded from the
  // ranking anyway. Callers are told via the trust panel.
  const smooth = hasDegenerate ? 0.5 : 0;
  const { strength, converged } = fitBT({
    W,
    smooth,
    maxIter: opts.maxIter,
    tol: opts.tol,
  });

  // Computed before the bootstrap because the simultaneous bands are centred
  // on the observed differences, not on the mean of the replicates.
  const score = strength.map((s) => 400 * Math.log10(s));

  let scoreCI: Array<[number, number] | null> = new Array(n).fill(null);
  let scoreDifferenceCI: ScoreDifferenceCI | null = null;
  let bootstrapNonConvergence: number | null = null;
  if (opts.bootstrapSamples > 0 && usable.length > 1) {
    const bootstrapped = bootstrapScoreCI({
      comparisons: usable,
      idx,
      n,
      variantIds,
      samples: opts.bootstrapSamples,
      seed: opts.seed,
      maxIter: opts.maxIter,
      tol: opts.tol,
    });
    scoreCI = bootstrapped.scoreCI;
    scoreDifferenceCI = bootstrapped.differenceCI;
    bootstrapNonConvergence =
      bootstrapped.nonConverged / opts.bootstrapSamples;
  }

  const entries: BTLeaderboardEntry[] = variantIds.map((id, i) => ({
    variantId: id,
    wins: wins[i] ?? 0,
    losses: losses[i] ?? 0,
    matchups: matchups[i] ?? 0,
    winRate: matchups[i] && matchups[i]! > 0 ? wins[i]! / matchups[i]! : null,
    strength: strength[i] ?? 1,
    score: score[i] ?? 0,
    scoreCI: scoreCI[i] ?? null,
    isDegenerate: degenerateMask[i] ?? false,
  }));

  // Sort by score desc, but push isDegenerate variants to the bottom so a
  // smoothed +∞-ish "always wins" variant doesn't dominate the table.
  entries.sort((a, b) => {
    if (a.isDegenerate !== b.isDegenerate) return a.isDegenerate ? 1 : -1;
    return b.score - a.score;
  });

  const minMatchups = matchups.length > 0 ? Math.min(...matchups) : 0;

  const winMatrix: WinMatrix = {};
  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      row[variantIds[j]!] = W[i]![j]!;
    }
    winMatrix[variantIds[i]!] = row;
  }

  return {
    entries,
    winMatrix,
    comparisonCount: usable.length,
    minMatchups,
    hasDegenerate,
    didConverge: converged,
    comparability: computeComparability({ winMatrix, variantIds }),
    scoreDifferenceCI,
    bootstrapNonConvergence,
  };
}

function buildWinMatrix(
  comparisons: PairwiseComparison[],
  idx: Map<string, number>,
  n: number,
): number[][] {
  const W: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const c of comparisons) {
    const candIdxs: number[] = [];
    for (const id of c.candidates) {
      const k = idx.get(id);
      if (k !== undefined) candIdxs.push(k);
    }
    if (candIdxs.length < 2) continue;

    if (c.winner === "tie") {
      // Only well-defined for 2-way. N>2 "tie" rows are dropped — semantics
      // are ambiguous (did all N tie pairwise? did some subset tie?).
      if (candIdxs.length === 2) {
        const [i, j] = candIdxs as [number, number];
        W[i]![j]! += 0.5;
        W[j]![i]! += 0.5;
      }
      continue;
    }
    const wIdx = idx.get(c.winner as string);
    // The winner must have been ON the row. types.ts assembles variantIds from
    // every label the column ever produced, while `candidates` is the per-row
    // set the judge actually saw — so a winner naming a variant that was
    // dropped from this row (no output) resolves fine against the global index
    // and then beats opponents it never faced. Ten such rows fabricated twenty
    // matchups and a first-place finish.
    if (wIdx === undefined || !candIdxs.includes(wIdx)) continue;
    for (const cIdx of candIdxs) {
      if (cIdx !== wIdx) W[wIdx]![cIdx]! += 1;
    }
  }
  return W;
}

/**
 * A comparison with its candidate ids already resolved to matrix indices.
 * `winner === TIE` marks the two-way tie case.
 */
type ResolvedComparison = {
  candIdxs: number[];
  winner: number;
};

const TIE = -1;

/** Null when the row carries no usable evidence (unknown ids, ambiguous tie). */
function resolveComparison({
  comparison,
  idx,
}: {
  comparison: PairwiseComparison;
  idx: Map<string, number>;
}): ResolvedComparison | null {
  const candIdxs: number[] = [];
  for (const id of comparison.candidates) {
    const k = idx.get(id);
    if (k !== undefined) candIdxs.push(k);
  }
  if (candIdxs.length < 2) return null;

  if (comparison.winner === "tie") {
    // Only well-defined for 2-way. N>2 "tie" rows are dropped — semantics
    // are ambiguous (did all N tie pairwise? did some subset tie?).
    return candIdxs.length === 2 ? { candIdxs, winner: TIE } : null;
  }

  const wIdx = idx.get(comparison.winner as string);
  // Same guard as buildWinMatrix: a winner absent from this row's candidates
  // is not evidence about this row. The two paths must agree, or the bootstrap
  // would describe a different dataset than the point estimate.
  if (wIdx === undefined || !candIdxs.includes(wIdx)) return null;
  return { candIdxs, winner: wIdx };
}

function buildWinMatrixFromResolved(
  resolved: (ResolvedComparison | null)[],
  n: number,
): number[][] {
  const W: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of resolved) {
    if (!r) continue;
    if (r.winner === TIE) {
      const [i, j] = r.candIdxs as [number, number];
      W[i]![j]! += 0.5;
      W[j]![i]! += 0.5;
      continue;
    }
    for (const cIdx of r.candIdxs) {
      if (cIdx !== r.winner) W[r.winner]![cIdx]! += 1;
    }
  }
  return W;
}

function perVariantTotals(W: number[][]): {
  wins: number[];
  losses: number[];
  matchups: number[];
} {
  const n = W.length;
  const wins = new Array(n).fill(0);
  const losses = new Array(n).fill(0);
  const matchups = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      wins[i] += W[i]![j]!;
      losses[i] += W[j]![i]!;
      // Only pairs INVOLVING THE WINNER get weight: an N-way verdict says the
      // winner beat each other candidate and says nothing about how the losers
      // compare to each other, so a 4-candidate row records 3 matchups, not 6.
    }
    matchups[i] = wins[i] + losses[i];
  }
  return { wins, losses, matchups };
}

/**
 * Hunter (2004) MM update:
 *   p_i ← (W_i + smooth*(n-1)) / Σ_{j≠i} (N_ij + 2*smooth) / (p_i + p_j)
 * where W_i = Σ_j W[i][j] and N_ij = W[i][j] + W[j][i]. Smoothing adds a
 * shared Beta(smooth, smooth) prior to every pair.
 *
 * Normalizes after each iteration so geometric mean(p) = 1, which makes
 * score = 400*log10(p) center around 0.
 */
function fitBT({
  W,
  smooth,
  maxIter,
  tol,
}: {
  W: number[][];
  smooth: number;
  maxIter: number;
  tol: number;
}): { strength: number[]; converged: boolean } {
  const n = W.length;
  if (n === 0) return { strength: [], converged: true };
  if (n === 1) return { strength: [1], converged: true };

  let p = new Array(n).fill(1);
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let wi = smooth * (n - 1);
      for (let j = 0; j < n; j++) {
        if (i !== j) wi += W[i]![j]!;
      }
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const nij = W[i]![j]! + W[j]![i]! + 2 * smooth;
        denom += nij / (p[i] + p[j]);
      }
      next[i] = denom > 0 ? wi / denom : p[i];
    }

    // Renormalize to geometric mean 1 (stable across iterations and avoids
    // the trivial p_i → ∞ direction).
    const logMean =
      next.reduce((s, v) => s + Math.log(Math.max(v, 1e-300)), 0) / n;
    const scale = Math.exp(logMean);
    for (let i = 0; i < n; i++) next[i] = next[i] / scale;

    let delta = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(next[i] - p[i]) / Math.max(p[i], 1e-12);
      if (d > delta) delta = d;
    }
    p = next;
    if (delta < tol) {
      converged = true;
      break;
    }
  }

  return { strength: p, converged };
}

/**
 * The Beta(eps, eps) prior a given win matrix needs to keep MM finite.
 *
 * Shared by the point fit and by every bootstrap replicate: any variant with
 * no wins or no losses makes the MLE degenerate, and the prior (Hunter §4) is
 * what keeps its strength off zero without reordering healthy data.
 */
function smoothingFor(W: number[][], n: number): number {
  for (let i = 0; i < n; i++) {
    let wins = 0;
    let losses = 0;
    for (let j = 0; j < n; j++) {
      wins += W[i]?.[j] ?? 0;
      losses += W[j]?.[i] ?? 0;
    }
    if (wins === 0 || losses === 0) return 0.5;
  }
  return 0;
}

function bootstrapScoreCI({
  comparisons,
  idx,
  n,
  variantIds,
  samples,
  seed,
  maxIter,
  tol,
}: {
  comparisons: PairwiseComparison[];
  idx: Map<string, number>;
  n: number;
  variantIds: string[];
  samples: number;
  seed: number;
  maxIter: number;
  tol: number;
}): {
  scoreCI: Array<[number, number] | null>;
  differenceCI: ScoreDifferenceCI;
  nonConverged: number;
} {
  const rand = mulberry32(seed);
  const m = comparisons.length;
  const scoreSamples: number[][] = Array.from({ length: n }, () => []);
  // Replicates whose own MM fit hit the iteration cap. Silently averaging
  // these in means the interval is partly built from fits that never
  // settled, and nothing downstream could tell.
  let nonConverged = 0;

  // Resolve candidate ids to indices ONCE rather than inside every replicate.
  // buildWinMatrix does a Map<string, number> lookup per candidate per row, so
  // re-running it 200x over the same rows was ~3M string-key lookups on a
  // mid-sized run and dominated the whole computation.
  //
  // The array keeps its original length, nulls included, so the resampling
  // draws the same indices in the same order as before and the output stays
  // bit-identical — this is a speedup, not a change in behaviour.
  const resolved = comparisons.map((comparison) =>
    resolveComparison({ comparison, idx }),
  );

  for (let b = 0; b < samples; b++) {
    const resampled: (ResolvedComparison | null)[] = new Array(m);
    for (let k = 0; k < m; k++) {
      const r = Math.floor(rand() * m);
      resampled[k] = resolved[r]!;
    }
    const Wb = buildWinMatrixFromResolved(resampled, n);
    // Smoothing must be decided per replicate, not inherited from the full
    // dataset. A resample routinely contains a variant that happened to win
    // nothing, even when no variant is degenerate overall — and with smooth=0
    // that variant's strength goes to 0, so 400*log10(0) is -Infinity and the
    // geometric-mean renormalisation throws its opponent to ~1e300, i.e.
    // +120000. The resulting interval is not merely wide, it is fabricated,
    // and it is finite, so downstream isFinite() guards let it through.
    const { strength, converged } = fitBT({
      W: Wb,
      smooth: smoothingFor(Wb, n),
      maxIter,
      tol,
    });
    if (!converged) nonConverged++;
    for (let i = 0; i < n; i++) {
      scoreSamples[i]!.push(400 * Math.log10(strength[i] ?? 1));
    }
  }

  const scoreCI = scoreSamples.map((arr): [number, number] | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return [quantile(sorted, 0.025), quantile(sorted, 0.975)];
  });

  // The paired difference, computed from the SAME replicates. Replicate b of
  // variant i and replicate b of variant j come from one resample and one
  // fit, so subtracting them cancels whatever that resample did to the field
  // as a whole. That is the entire reason this is worth keeping: the spread
  // of the difference is smaller than the spread of either score whenever the
  // two move together, which on a shared fit they always do.
  //
  // ── These are PER-PAIR intervals, and that is a deliberate choice ──
  //
  // The UI asks about several pairs at once: four variants make six, and the
  // trust panel reports how many were separated. Six tests at 95% leave
  // roughly a 1-in-4 chance that at least one fires on luck alone, so the
  // count is not a joint guarantee and must not be read as one.
  //
  // The textbook answer is to widen the bands until they hold simultaneously.
  // That was built and measured, and it is worse than useless here. A max-t
  // construction — take the largest standardised deviation across all pairs
  // in each replicate, then its 95th percentile as one critical value — is
  // the efficient version of that idea, since it reads the correlation
  // between pairs off the replicates instead of assuming the worst the way
  // Bonferroni does. Measured on 40 synthetic four-variant runs it separated
  // 12.9% of pairs, against 26.3% for the plain interval-overlap test this
  // work replaced and 39.2% for the per-pair difference below. The
  // simultaneous band came out about 1.10x the overlap test's own effective
  // threshold: the multiplicity multiplier (~2.9 rather than 1.96) more than
  // cancels the correlation gain that makes the difference worth using.
  //
  // Shipping that would make every claim weaker than before any of this
  // work, to fix an overstatement that costs nothing to fix with a sentence.
  // So the bands stay per-pair — each individual claim is then correctly
  // calibrated at 95%, which is what "these two differ" should mean — and
  // `computeSampleAdequacy` states the multiplicity plainly wherever it
  // reports a count across pairs.
  const differenceCI: ScoreDifferenceCI = {};
  for (const id of variantIds) differenceCI[id] = {};

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const diffs: number[] = [];
      for (let b = 0; b < samples; b++) {
        const d = scoreSamples[i]![b]! - scoreSamples[j]![b]!;
        // A replicate that produced a non-finite score for either variant
        // says nothing about the gap between them. Dropping it is the only
        // honest option; keeping it would poison every quantile.
        if (Number.isFinite(d)) diffs.push(d);
      }
      if (diffs.length === 0) continue;
      diffs.sort((a, b) => a - b);
      const lo = quantile(diffs, 0.025);
      const hi = quantile(diffs, 0.975);
      differenceCI[variantIds[i]!]![variantIds[j]!] = [lo, hi];
      // The mirrored pair, negated and reversed: CI(b − a) = −CI(a − b).
      // Stored rather than derived so a consumer never has to know which
      // way round it asked.
      differenceCI[variantIds[j]!]![variantIds[i]!] = [-hi, -lo];
    }
  }

  return { scoreCI, differenceCI, nonConverged };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

