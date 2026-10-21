/**
 * Bradley-Terry MLE leaderboard for the Comparison evaluator (#5103). Pure client-side
 * helper — mirrors the shape of `computeBatchAggregates.ts`. No I/O, no React.
 */

import { mulberry32, percentileInterval95 } from "./batch-evaluation-results.bootstrap-ci.ts";
import {
  type Comparability,
  computeComparability,
} from "./batch-evaluation-results.comparability.ts";

export type PairwiseComparison = {
  /** Candidate target ids involved in this comparison (>= 2). */
  candidates: string[];
  /**
   * Winning target id, "tie" for an explicit tie, or null to skip the row
   * (pending / error / unknown). Tie semantics are only well-defined for
   * 2-candidate rows; for N>2 a "tie" row is treated as null.
   */
  winner: string | null;
};

export type BTLeaderboardEntry = {
  variantId: string;
  /** Total wins (1 per win, 0.5 per tie). */
  wins: number;
  /** Total losses (1 per loss, 0.5 per tie). */
  losses: number;
  /**
   * Total PAIRWISE matchups this variant took part in — wins + losses in the win
   * matrix, where an N-way verdict contributes one matchup per pair it implies.
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
 * Pair-by-pair win count: matrix[a][b] = number of times variant a beat variant b (ties
 * count 0.5 to each side). Keyed by variantId (not index) so the consumer doesn't have
 * to track ordering. The heatmap in PairwiseLeaderboard reads this directly.
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
   */
  comparability: Comparability;
  /**
   * 95% CI of the DIFFERENCE between two scores, per ordered pair. Null when the
   * bootstrap did not run.
   */
  scoreDifferenceCI: ScoreDifferenceCI | null;
  /**
   * Share of bootstrap replicates whose own fit hit the iteration cap instead of
   * settling. Null when the bootstrap did not run.
   */
  bootstrapNonConvergence: number | null;
};

/**
 * `scoreDifferenceCI[a][b]` is the 95% interval for (score of a) − (score of
 * b). Keyed by variantId rather than index so consumers holding an entry can
 * look a pair up without tracking the fit's ordering.
 */
export type ScoreDifferenceCI = Record<string, Record<string, [number, number]>>;

export type BTLeaderboardOptions = {
  /**
   * Bootstrap resamples for CI. 0 disables. Default: 1000.
   */
  bootstrapSamples?: number;
  /** Deterministic seed (mulberry32). Default: 1. */
  seed?: number;
  /** MM solver iteration cap. Default: 500. */
  maxIter?: number;
  /** MM solver convergence tolerance on max relative strength change. Default: 1e-6. */
  tol?: number;
};

/**
 * Beta(eps, eps) pseudo-count added to every pair when the field contains a degenerate
 * variant, so the MM fit stays finite (Hunter §4).
 */
const DEGENERATE_SMOOTHING_EPS = 0.5;

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

  if (n === 0) return emptyLeaderboard();

  const idx = new Map(variantIds.map((id, i) => [id, i]));
  // Rows that survive to contribute evidence.
  const usable = comparisons
    .map((comparison) => resolveComparison({ comparison, idx }))
    .filter((resolved): resolved is ResolvedComparison => resolved !== null);

  const W = buildWinMatrix({ resolved: usable, n });
  const { wins, losses, matchups } = perVariantTotals(W);

  const degenerateMask = wins.map((w, i) => w === 0 || losses[i] === 0);
  const hasDegenerate = degenerateMask.some(Boolean);

  // Smoothing keeps MM finite when at least one variant is degenerate. A shared
  // Beta(eps, eps) prior across every pair is the standard fix (Hunter §4).
  const smooth = hasDegenerate ? DEGENERATE_SMOOTHING_EPS : 0;
  const fitted = createBTSolver(n).fit({
    W: flatten(W),
    smooth,
    maxIter: opts.maxIter,
    tol: opts.tol,
  });
  const strength = Array.from(fitted.strength);
  const { didConverge } = fitted;

  // Computed before the bootstrap because the simultaneous bands are centred
  // on the observed differences, not on the mean of the replicates.
  const score = strength.map((s) => 400 * Math.log10(s));

  const bootstrap = bootstrapIntervals({
    resolved: usable,
    n,
    variantIds,
    opts,
  });

  const entries = buildEntries({
    variantIds,
    wins,
    losses,
    matchups,
    strength,
    score,
    scoreCI: bootstrap.scoreCI,
    degenerateMask,
  });

  const winMatrix = toWinMatrix({ W, variantIds });

  return {
    entries,
    winMatrix,
    comparisonCount: usable.length,
    minMatchups: matchups.length > 0 ? Math.min(...matchups) : 0,
    hasDegenerate,
    didConverge,
    comparability: computeComparability({ winMatrix, variantIds }),
    scoreDifferenceCI: bootstrap.differenceCI,
    bootstrapNonConvergence: bootstrap.nonConvergence,
  };
}

function emptyLeaderboard(): BTLeaderboard {
  return {
    entries: [],
    winMatrix: {},
    comparisonCount: 0,
    minMatchups: 0,
    hasDegenerate: false,
    // `false`, not `true`.
    didConverge: false,
    comparability: { identifiable: false, groups: [], dominates: [] },
    scoreDifferenceCI: null,
    bootstrapNonConvergence: null,
  };
}

function buildEntries({
  variantIds,
  wins,
  losses,
  matchups,
  strength,
  score,
  scoreCI,
  degenerateMask,
}: {
  variantIds: string[];
  wins: number[];
  losses: number[];
  matchups: number[];
  strength: number[];
  score: number[];
  scoreCI: ([number, number] | null)[];
  degenerateMask: boolean[];
}): BTLeaderboardEntry[] {
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
  entries.sort(byScoreDegenerateLast);
  return entries;
}

/**
 * Sort by score desc, but push degenerate variants to the bottom so a
 * smoothed +∞-ish "always wins" variant doesn't dominate the table.
 */
function byScoreDegenerateLast(a: BTLeaderboardEntry, b: BTLeaderboardEntry): number {
  if (a.isDegenerate !== b.isDegenerate) return a.isDegenerate ? 1 : -1;
  return b.score - a.score;
}

/** Index-keyed win counts re-keyed by variantId for the heatmap. */
function toWinMatrix({ W, variantIds }: { W: number[][]; variantIds: string[] }): WinMatrix {
  const n = variantIds.length;
  const winMatrix: WinMatrix = {};
  for (let i = 0; i < n; i++) {
    const row: Record<string, number> = {};
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      row[variantIds[j]!] = W[i]![j]!;
    }
    winMatrix[variantIds[i]!] = row;
  }
  return winMatrix;
}

const TIE = -1;

/** A comparison with matrix indices; a tie is meaningful only for two candidates. */
type ResolvedComparison =
  | {
      candIdxs: [number, number];
      winner: typeof TIE;
    }
  | {
      candIdxs: number[];
      winner: number;
    };

/** Null when the row carries no usable evidence (unknown ids, ambiguous tie). */
function resolveComparison({
  comparison,
  idx,
}: {
  comparison: PairwiseComparison;
  idx: Map<string, number>;
}): ResolvedComparison | null {
  // Deduplicated: `targetIdByAnyKey` maps several keys onto one target, so a
  // row can name the same variant twice. Undeduplicated, ["a","b","b"] with
  // winner "a" credited a two-nil record from a single verdict — the matchup
  // counted twice and the interval tightened around evidence that was only
  // ever produced once.
  const seen = new Set<number>();
  const candIdxs: number[] = [];
  for (const id of comparison.candidates) {
    const k = idx.get(id);
    if (k !== void 0 && !seen.has(k)) {
      seen.add(k);
      candIdxs.push(k);
    }
  }
  if (candIdxs.length < 2) return null;

  if (comparison.winner === "tie") {
    // Only well-defined for 2-way. N>2 "tie" rows are dropped — semantics
    // are ambiguous (did all N tie pairwise? did some subset tie?).
    if (candIdxs.length !== 2) return null;

    const [firstCandidate, secondCandidate] = candIdxs;
    if (firstCandidate === void 0 || secondCandidate === void 0) return null;

    return { candIdxs: [firstCandidate, secondCandidate], winner: TIE };
  }

  if (comparison.winner === null) return null;

  const wIdx = idx.get(comparison.winner);
  // The winner must have been in this row's candidates.
  if (wIdx === void 0 || !candIdxs.includes(wIdx)) return null;
  return { candIdxs, winner: wIdx };
}

function buildWinMatrix({
  resolved,
  n,
}: {
  resolved: ResolvedComparison[];
  n: number;
}): number[][] {
  const W: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (const r of resolved) {
    if (r.winner === TIE) {
      const [i, j] = r.candIdxs;
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
  const wins = Array.from({ length: n }, () => 0);
  const losses = Array.from({ length: n }, () => 0);
  const matchups = Array.from({ length: n }, () => 0);
  for (let i = 0; i < n; i++) {
    let variantWins = 0;
    let variantLosses = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      variantWins += W[i]![j]!;
      variantLosses += W[j]![i]!;
      // Only pairs INVOLVING THE WINNER get weight: an N-way verdict says the
      // winner beat each other candidate and says nothing about how the losers
      // compare to each other, so a 4-candidate row records 3 matchups, not 6.
    }
    wins[i] = variantWins;
    losses[i] = variantLosses;
    matchups[i] = variantWins + variantLosses;
  }
  return { wins, losses, matchups };
}

/**
 * Hunter (2004) MM update: p_i ← (W_i + smooth*(n-1)) / Σ_{j≠i} (N_ij + 2*smooth) /
 * (p_i + p_j) where W_i = Σ_j W[i][j] and N_ij = W[i][j] + W[j][i]. Smoothing adds a
 * shared Beta(smooth, smooth) prior to every pair. Flat arrays: experiment ADR-002.
 */
type BTSolver = {
  fit: (input: { W: Float64Array; smooth: number; maxIter: number; tol: number }) => {
    strength: Float64Array;
    didConverge: boolean;
  };
};

/** wins[i] = W_i + smooth*(n-1); pairMass[i*n+j] = N_ij + 2*smooth. */
function loadWinsAndPairMass({
  W,
  n,
  smooth,
  wins,
  pairMass,
}: {
  W: Float64Array;
  n: number;
  smooth: number;
  wins: Float64Array;
  pairMass: Float64Array;
}): void {
  for (let i = 0; i < n; i++) {
    let wi = smooth * (n - 1);
    for (let j = 0; j < n; j++) {
      if (i !== j) wi += W[i * n + j]!;
    }
    wins[i] = wi;
    for (let j = 0; j < n; j++) {
      pairMass[i * n + j] = W[i * n + j]! + W[j * n + i]! + 2 * smooth;
    }
  }
}

function createBTSolver(n: number): BTSolver {
  const wins = new Float64Array(n);
  const pairMass = new Float64Array(n * n);
  const denom = new Float64Array(n);
  let p = new Float64Array(n);
  let next = new Float64Array(n);

  const fit: BTSolver["fit"] = ({ W, smooth, maxIter, tol }) => {
    if (n === 0) return { strength: new Float64Array(0), didConverge: true };
    if (n === 1) return { strength: Float64Array.of(1), didConverge: true };

    loadWinsAndPairMass({ W, n, smooth, wins, pairMass });
    p.fill(1);
    for (let iter = 0; iter < maxIter; iter++) {
      mmSweep({ n, wins, pairMass, p, denom, next });
      normalizeToGeometricMean(next);
      const delta = maxRelativeChange({ next, previous: p });
      const settled = p;
      p = next;
      next = settled;
      if (delta < tol) return { strength: p, didConverge: true };
    }
    return { strength: p, didConverge: false };
  };

  return { fit };
}

/**
 * One MM iteration over every variant; holds p_i when the pair mass is zero. N_ij /
 * (p_i + p_j) is the same number both ways round, so each pair is divided once and
 * credited to both sides, still summed in ascending j: the same sums as before.
 */
function mmSweep({
  n,
  wins,
  pairMass,
  p,
  denom,
  next,
}: {
  n: number;
  wins: Float64Array;
  pairMass: Float64Array;
  p: Float64Array;
  denom: Float64Array;
  next: Float64Array;
}): void {
  denom.fill(0);
  for (let i = 0; i < n; i++) {
    const pi = p[i]!;
    for (let j = i + 1; j < n; j++) {
      const term = pairMass[i * n + j]! / (pi + p[j]!);
      denom[i] = denom[i]! + term;
      denom[j] = denom[j]! + term;
    }
  }
  for (let i = 0; i < n; i++) {
    next[i] = denom[i]! > 0 ? wins[i]! / denom[i]! : p[i]!;
  }
}

/**
 * Renormalize in place to geometric mean 1 (stable across iterations and
 * avoids the trivial p_i → ∞ direction).
 */
function normalizeToGeometricMean(values: Float64Array): void {
  const n = values.length;
  let logSum = 0;
  for (let i = 0; i < n; i++) logSum += Math.log(Math.max(values[i]!, 1e-300));
  const scale = Math.exp(logSum / n);
  for (let i = 0; i < n; i++) values[i] = values[i]! / scale;
}

/** Largest relative move across the field — the MM convergence test. */
function maxRelativeChange({
  next,
  previous,
}: {
  next: Float64Array;
  previous: Float64Array;
}): number {
  let delta = 0;
  for (let i = 0; i < next.length; i++) {
    const d = Math.abs(next[i]! - previous[i]!) / Math.max(previous[i]!, 1e-12);
    if (d > delta) delta = d;
  }
  return delta;
}

/** The win matrix flattened row-major, the solver's layout. */
function flatten(W: number[][]): Float64Array {
  const n = W.length;
  const flat = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) flat[i * n + j] = W[i]![j]!;
  }
  return flat;
}

/**
 * The Beta(eps, eps) prior a given win matrix needs to keep MM finite.
 */
function smoothingFor(W: Float64Array, n: number): number {
  for (let i = 0; i < n; i++) {
    let wins = 0;
    let losses = 0;
    for (let j = 0; j < n; j++) {
      wins += W[i * n + j]!;
      losses += W[j * n + i]!;
    }
    if (wins === 0 || losses === 0) return 0.5;
  }
  return 0;
}

/**
 * Each usable row as the win-matrix cells it adds to, so a resample can rebuild
 * the matrix without revisiting candidates: row r adds `weight[e]` to
 * `cell[e]` for e in [start[r], start[r + 1]).
 */
type EncodedRows = { start: Int32Array; cell: Int32Array; weight: Float64Array };

function encodeRows({ resolved, n }: { resolved: ResolvedComparison[]; n: number }): EncodedRows {
  const start = new Int32Array(resolved.length + 1);
  const cells: number[] = [];
  const weights: number[] = [];
  resolved.forEach((r, k) => {
    start[k] = cells.length;
    if (r.winner === TIE) {
      const [i, j] = r.candIdxs;
      cells.push(i * n + j, j * n + i);
      weights.push(0.5, 0.5);
      return;
    }
    for (const cIdx of r.candIdxs) {
      if (cIdx === r.winner) continue;
      cells.push(r.winner * n + cIdx);
      weights.push(1);
    }
  });
  start[resolved.length] = cells.length;
  return { start, cell: Int32Array.from(cells), weight: Float64Array.from(weights) };
}

/** The bootstrap outputs, or their disabled stand-ins when it does not run. */
function bootstrapIntervals({
  resolved,
  n,
  variantIds,
  opts,
}: {
  resolved: ResolvedComparison[];
  n: number;
  variantIds: string[];
  opts: Required<BTLeaderboardOptions>;
}): {
  scoreCI: ([number, number] | null)[];
  differenceCI: ScoreDifferenceCI | null;
  nonConvergence: number | null;
} {
  if (opts.bootstrapSamples > 0 && resolved.length > 1) {
    const bootstrapped = bootstrapScoreCI({
      resolved,
      n,
      variantIds,
      samples: opts.bootstrapSamples,
      seed: opts.seed,
      maxIter: opts.maxIter,
      tol: opts.tol,
    });
    return {
      scoreCI: bootstrapped.scoreCI,
      differenceCI: bootstrapped.differenceCI,
      nonConvergence: bootstrapped.nonConverged / opts.bootstrapSamples,
    };
  }
  return {
    scoreCI: Array.from({ length: n }, () => null),
    differenceCI: null,
    nonConvergence: null,
  };
}

function bootstrapScoreCI({
  resolved,
  n,
  variantIds,
  samples,
  seed,
  maxIter,
  tol,
}: {
  resolved: ResolvedComparison[];
  n: number;
  variantIds: string[];
  samples: number;
  seed: number;
  maxIter: number;
  tol: number;
}): {
  scoreCI: ([number, number] | null)[];
  differenceCI: ScoreDifferenceCI;
  nonConverged: number;
} {
  const { scoreSamples, nonConverged } = runBootstrapReplicates({
    resolved,
    n,
    samples,
    seed,
    maxIter,
    tol,
  });

  // Differences first: the per-variant intervals reorder their replicates.
  const differenceCI = pairwiseDifferenceCIs({ scoreSamples, n, variantIds, samples });
  const scoreCI = Array.from({ length: n }, (_, i) =>
    percentileInterval95(scoreSamples.subarray(i * samples, (i + 1) * samples)),
  );

  return { scoreCI, differenceCI, nonConverged };
}

/**
 * Resample the rows `samples` times, refitting the whole field each time.
 * `scoreSamples[i * samples + b]` is variant i's score in replicate b.
 */
function runBootstrapReplicates({
  resolved,
  n,
  samples,
  seed,
  maxIter,
  tol,
}: {
  resolved: ResolvedComparison[];
  n: number;
  samples: number;
  seed: number;
  maxIter: number;
  tol: number;
}): { scoreSamples: Float64Array; nonConverged: number } {
  const rand = mulberry32(seed);
  const m = resolved.length;
  const rows = encodeRows({ resolved, n });
  const solver = createBTSolver(n);
  const Wb = new Float64Array(n * n);
  const scoreSamples = new Float64Array(n * samples);
  // Replicates whose own MM fit hit the iteration cap. Silently averaging
  // these in means the interval is partly built from fits that never
  // settled, and nothing downstream could tell.
  let nonConverged = 0;

  for (let b = 0; b < samples; b++) {
    Wb.fill(0);
    for (let k = 0; k < m; k++) {
      const r = Math.floor(rand() * m);
      for (let e = rows.start[r]!; e < rows.start[r + 1]!; e++) {
        const cell = rows.cell[e]!;
        Wb[cell] = Wb[cell]! + rows.weight[e]!;
      }
    }
    // Smoothing must be decided per replicate, not inherited from the full dataset.
    const { strength, didConverge } = solver.fit({
      W: Wb,
      smooth: smoothingFor(Wb, n),
      maxIter,
      tol,
    });
    if (!didConverge) nonConverged++;
    for (let i = 0; i < n; i++) {
      scoreSamples[i * samples + b] = 400 * Math.log10(strength[i] ?? 1);
    }
  }

  return { scoreSamples, nonConverged };
}

/**
 * Per-pair CIs use score differences from the same bootstrap replicate, which cancels
 * shared field movement. They calibrate each individual pair at 95%; they are not a
 * simultaneous guarantee across the whole leaderboard.
 */
function pairwiseDifferenceCIs({
  scoreSamples,
  n,
  variantIds,
  samples,
}: {
  scoreSamples: Float64Array;
  n: number;
  variantIds: string[];
  samples: number;
}): ScoreDifferenceCI {
  const differenceCI: ScoreDifferenceCI = {};
  for (const id of variantIds) differenceCI[id] = {};

  const diffs = new Float64Array(samples);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let count = 0;
      for (let s = 0; s < samples; s++) {
        const d = scoreSamples[i * samples + s]! - scoreSamples[j * samples + s]!;
        // A non-finite score says nothing about the gap; keeping it would poison the quantiles.
        if (Number.isFinite(d)) diffs[count++] = d;
      }
      const interval = percentileInterval95(diffs, count);
      if (!interval) continue;
      const [lo, hi] = interval;
      differenceCI[variantIds[i]!]![variantIds[j]!] = [lo, hi];
      // The mirrored pair, negated and reversed: CI(b − a) = −CI(a − b).
      // Stored rather than derived so a consumer never has to know which
      // way round it asked.
      differenceCI[variantIds[j]!]![variantIds[i]!] = [-hi, -lo];
    }
  }

  return differenceCI;
}
