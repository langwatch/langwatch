/**
 * Per-variant cost/duration aggregation for the Comparison leaderboard's cost/duration
 * tradeoff chart (#5103) — how much a candidate typically costs and how long it takes,
 * across the rows it participated in.
 */
import { computeMetricStats, type MetricStats } from "@langwatch/experiment-contract";

import {
  bootstrapMeanCI,
  bootstrapPairedDifferenceCIs,
} from "../../model/batch-evaluation-results.bootstrap-ci.ts";
import type { BatchResultRow } from "./batch-evaluation-results.types.ts";

export type VariantMetrics = {
  variantId: string;
  costStats: MetricStats | null;
  durationStats: MetricStats | null;
  /**
   * 95% CI for the MEAN cost, not the spread of the rows.
   */
  costMeanCI: [number, number] | null;
  /** 95% CI for the mean duration, on the same terms as `costMeanCI`. */
  durationMeanCI: [number, number] | null;
  /**
   * 95% CI for the mean per-row cost difference against each other variant, keyed by
   * that variant's id. `costDifferenceCI[other]` is this variant's cost minus that
   * one's, so an interval entirely below zero means this one is genuinely cheaper.
   */
  costDifferenceCI: Record<string, [number, number]>;
  /** The same for duration. */
  durationDifferenceCI: Record<string, [number, number]>;
};

/**
 * A stable seed from the variant id, so the same variant resamples the same
 * way every render. A fixed constant would make every variant draw the same
 * index pattern, which correlates their intervals for no reason.
 */
const seedFor = (variantId: string): number => {
  let h = 2166136261;
  for (let i = 0; i < variantId.length; i++) {
    h ^= variantId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
};

/**
 * Rows a metric needs before it may carry a claim.
 */
export const MIN_PRICED_ROWS = 5;

/** Per-row value for a variant, `null` where the row recorded nothing. */
const readByRow = ({
  rows,
  variantId,
  metric,
}: {
  rows: BatchResultRow[];
  variantId: string;
  metric: "cost" | "duration";
}): (number | null)[] =>
  rows.map((row) => {
    const target = row.targets[variantId];
    const value = target ? target[metric] : null;
    return value === null || value === void 0 || !Number.isFinite(value) ? null : value;
  });

/**
 * Interval for the mean per-row DIFFERENCE between two variants, over the rows where
 * both recorded a value.
 */
const pairedDifferenceCI = ({
  a,
  b,
  seed,
}: {
  a: (number | null)[];
  b: (number | null)[];
  seed: number;
}): [number, number] | null => {
  const differences: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left === null || right === null) continue;
    if (left === void 0 || right === void 0) continue;
    differences.push(left - right);
  }
  // The per-variant floor is not enough on its own. Two variants can each clear it
  // comfortably and still SHARE almost no rows — priced on different halves of the run
  // — and the paired sample is what this interval is actually built from.
  if (differences.length < MIN_PRICED_ROWS) return null;
  return bootstrapMeanCI({ values: differences, seed });
};

/**
 * Share of the run's recorded rows a pair must have in common to join the shared
 * resampling. Above it the interval widens by under 1% of itself, inside the Monte
 * Carlo noise; below it the pair is resampled on its own as before (experiment ADR-002).
 */
const SHARED_RESAMPLING_MIN_OVERLAP = 0.9;

const isRecorded = (value: number | null | undefined): value is number =>
  value !== null && value !== void 0;

/** Rows where both variants recorded a value. */
const sharedRowCount = (a: (number | null)[], b: (number | null)[]): number => {
  let shared = 0;
  for (let r = 0; r < a.length; r++) {
    if (isRecorded(a[r]) && isRecorded(b[r])) shared++;
  }
  return shared;
};

/** Rows some variant recorded. The rest (still running, never priced) are no pair's evidence. */
const recordedRowsOf = (columns: (number | null)[][]): number[] => {
  const recorded: number[] = [];
  for (let r = 0; r < (columns[0]?.length ?? 0); r++) {
    if (columns.some((column) => isRecorded(column[r]))) recorded.push(r);
  }
  return recorded;
};

type Pair = { left: number; right: number; sharedRows: number };

/** Every unordered pair of positions, left before right, with the rows it shares. */
const unorderedPairs = (columns: (number | null)[][]): Pair[] =>
  columns.flatMap((leftColumn, left) =>
    columns.slice(left + 1).map((rightColumn, offset) => ({
      left,
      right: left + 1 + offset,
      sharedRows: sharedRowCount(leftColumn, rightColumn),
    })),
  );

/** Both directions of every pair that has an interval: CI(b − a) = −CI(a − b). */
const mirrored = ({
  variantIds,
  intervals,
}: {
  variantIds: string[];
  intervals: Map<Pair, [number, number] | null>;
}): Record<string, Record<string, [number, number]>> => {
  const byVariant: Record<string, Record<string, [number, number]>> = {};
  for (const variantId of variantIds) {
    byVariant[variantId] = {};
  }
  for (const [{ left, right }, difference] of intervals) {
    if (!difference) continue;
    byVariant[variantIds[left]!]![variantIds[right]!] = difference;
    byVariant[variantIds[right]!]![variantIds[left]!] = [-difference[1], -difference[0]];
  }
  return byVariant;
};

/**
 * Every pair's interval, once per UNORDERED pair and mirrored exactly. Pairs that
 * recorded (nearly) the same rows share one resampling, seeded per metric; a pair
 * overlapping on only part of the run is resampled on its own, under its own seed.
 */
const pairedDifferenceCIs = ({
  variantIds,
  valuesByRow,
  seed,
}: {
  variantIds: string[];
  valuesByRow: Record<string, (number | null)[]>;
  seed: number;
}): Record<string, Record<string, [number, number]>> => {
  const columns = variantIds.map((id) => valuesByRow[id]!);
  const recordedRows = recordedRowsOf(columns);
  const pairs = unorderedPairs(columns);
  const sharesTheRun = (pair: Pair) =>
    pair.sharedRows >= SHARED_RESAMPLING_MIN_OVERLAP * recordedRows.length;

  // Insertion order follows `pairs`, so the result's key order does not depend on
  // which pairs shared the resampling.
  const intervals = new Map<Pair, [number, number] | null>(pairs.map((pair) => [pair, null]));

  // The paired-sample floor `pairedDifferenceCI` applies, applied to these too.
  const sharedPairs = pairs.filter(
    (pair) => sharesTheRun(pair) && pair.sharedRows >= MIN_PRICED_ROWS,
  );
  const sharedIntervals = bootstrapPairedDifferenceCIs({
    columns: columns.map((column) => recordedRows.map((r) => column[r] ?? null)),
    pairs: sharedPairs.map(({ left, right }) => [left, right]),
    seed,
  });
  sharedPairs.forEach((pair, k) => intervals.set(pair, sharedIntervals[k] ?? null));

  for (const pair of pairs.filter((candidate) => !sharesTheRun(candidate))) {
    intervals.set(
      pair,
      pairedDifferenceCI({
        a: columns[pair.left]!,
        b: columns[pair.right]!,
        // NUL rather than a space: variant ids are free-form, and with a
        // space "a b" + "c" and "a" + "b c" hash to the same seed.
        seed: seedFor(`${variantIds[pair.left]}\u0000${variantIds[pair.right]}`),
      }),
    );
  }

  return mirrored({ variantIds, intervals });
};

export function computeVariantMetrics({
  variantIds,
  rows,
}: {
  variantIds: string[];
  rows: BatchResultRow[];
}): Record<string, VariantMetrics> {
  const result: Record<string, VariantMetrics> = {};

  const costByRow: Record<string, (number | null)[]> = {};
  const durationByRow: Record<string, (number | null)[]> = {};
  for (const variantId of variantIds) {
    costByRow[variantId] = readByRow({ rows, variantId, metric: "cost" });
    durationByRow[variantId] = readByRow({
      rows,
      variantId,
      metric: "duration",
    });
  }

  const costDifferenceCI = pairedDifferenceCIs({
    variantIds,
    valuesByRow: costByRow,
    seed: seedFor("cost"),
  });
  const durationDifferenceCI = pairedDifferenceCIs({
    variantIds,
    valuesByRow: durationByRow,
    seed: seedFor("duration"),
  });

  for (const variantId of variantIds) {
    const costs = costByRow[variantId]!.filter((v): v is number => v !== null);
    const durations = durationByRow[variantId]!.filter((v): v is number => v !== null);

    result[variantId] = {
      variantId,
      costStats: computeMetricStats(costs),
      durationStats: computeMetricStats(durations),
      // Seeded per variant so a variant's interval is stable across renders and across
      // which other variants happen to be in the run, but two variants do not share a
      // resampling pattern.
      costMeanCI: bootstrapMeanCI({ values: costs, seed: seedFor(variantId) }),
      durationMeanCI: bootstrapMeanCI({
        values: durations,
        seed: seedFor(`${variantId}\u0000duration`),
      }),
      costDifferenceCI: costDifferenceCI[variantId]!,
      durationDifferenceCI: durationDifferenceCI[variantId]!,
    };
  }

  return result;
}
