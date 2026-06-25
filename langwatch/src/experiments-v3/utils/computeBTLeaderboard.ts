/**
 * Bradley-Terry MLE leaderboard for the pairwise / N-way compare evaluator
 * (#5103, stacked on #5101). Pure client-side helper — mirrors the shape of
 * `computeAggregates.ts`. No I/O, no React.
 *
 * Math: iterative MM update from Hunter (2004) "MM algorithms for generalized
 * Bradley-Terry models". Bootstrap percentile CIs for the Elo-style score.
 * Tie convention: 0.5 win + 0.5 loss to each side (LMSYS Arena).
 */

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
  /** Total matchups (non-skipped rows involving this variant). */
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
  degenerate: boolean;
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
};

export type BTLeaderboardOptions = {
  /** Bootstrap resamples for CI. 0 disables. Default: 200. */
  bootstrapSamples?: number;
  /** Deterministic seed (mulberry32). Default: 1. */
  seed?: number;
  /** MM solver iteration cap. Default: 500. */
  maxIter?: number;
  /** MM solver convergence tolerance on max relative strength change. Default: 1e-6. */
  tol?: number;
};

const DEFAULT_OPTS: Required<BTLeaderboardOptions> = {
  bootstrapSamples: 200,
  seed: 1,
  maxIter: 500,
  tol: 1e-6,
};

export function computeBTLeaderboard(
  comparisons: PairwiseComparison[],
  variantIds: string[],
  options: BTLeaderboardOptions = {},
): BTLeaderboard {
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
    };
  }

  const idx = new Map(variantIds.map((id, i) => [id, i]));
  const usable = comparisons.filter((c) => c.winner !== null);

  const W = buildWinMatrix(usable, idx, n);
  const { wins, losses, matchups } = perVariantTotals(W);

  const degenerateMask = wins.map((w, i) => w === 0 || losses[i] === 0);
  const hasDegenerate = degenerateMask.some(Boolean);

  // Smoothing keeps MM finite when at least one variant is degenerate. A
  // shared Beta(eps, eps) prior across every pair is the standard fix
  // (Hunter §4) — it shrinks the leaderboard slightly without changing
  // ordering on healthy data.
  const smooth = hasDegenerate ? 0.5 : 0;
  const { strength, converged } = fitBT(W, smooth, opts.maxIter, opts.tol);

  let scoreCI: Array<[number, number] | null> = new Array(n).fill(null);
  if (opts.bootstrapSamples > 0 && usable.length > 1) {
    scoreCI = bootstrapScoreCI(
      usable,
      idx,
      n,
      smooth,
      opts.bootstrapSamples,
      opts.seed,
      opts.maxIter,
      opts.tol,
    );
  }

  const score = strength.map((s) => 400 * Math.log10(s));

  const entries: BTLeaderboardEntry[] = variantIds.map((id, i) => ({
    variantId: id,
    wins: wins[i] ?? 0,
    losses: losses[i] ?? 0,
    matchups: matchups[i] ?? 0,
    winRate: matchups[i] && matchups[i]! > 0 ? wins[i]! / matchups[i]! : null,
    strength: strength[i] ?? 1,
    score: score[i] ?? 0,
    scoreCI: scoreCI[i] ?? null,
    degenerate: degenerateMask[i] ?? false,
  }));

  // Sort by score desc, but push degenerate variants to the bottom so a
  // smoothed +∞-ish "always wins" variant doesn't dominate the table.
  entries.sort((a, b) => {
    if (a.degenerate !== b.degenerate) return a.degenerate ? 1 : -1;
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
    if (wIdx === undefined) continue;
    for (const cIdx of candIdxs) {
      if (cIdx !== wIdx) W[wIdx]![cIdx]! += 1;
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
      // matchups counts each pair once per row; W[i][j] + W[j][i] is the
      // total weight of rows where i and j faced off.
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
function fitBT(
  W: number[][],
  smooth: number,
  maxIter: number,
  tol: number,
): { strength: number[]; converged: boolean } {
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

function bootstrapScoreCI(
  comparisons: PairwiseComparison[],
  idx: Map<string, number>,
  n: number,
  smooth: number,
  samples: number,
  seed: number,
  maxIter: number,
  tol: number,
): Array<[number, number] | null> {
  const rand = mulberry32(seed);
  const m = comparisons.length;
  const scoreSamples: number[][] = Array.from({ length: n }, () => []);

  for (let b = 0; b < samples; b++) {
    const resampled: PairwiseComparison[] = new Array(m);
    for (let k = 0; k < m; k++) {
      const r = Math.floor(rand() * m);
      resampled[k] = comparisons[r]!;
    }
    const Wb = buildWinMatrix(resampled, idx, n);
    const { strength } = fitBT(Wb, smooth, maxIter, tol);
    for (let i = 0; i < n; i++) {
      scoreSamples[i]!.push(400 * Math.log10(strength[i] ?? 1));
    }
  }

  return scoreSamples.map((arr) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const lo = quantile(sorted, 0.025);
    const hi = quantile(sorted, 0.975);
    return [lo, hi];
  });
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

/**
 * Mulberry32 PRNG. Deterministic, no dependencies, good enough for bootstrap
 * resampling. Same seed → identical sequence across platforms.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
