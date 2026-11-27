import type { LabelShare } from "@langwatch/evaluation-contract";

import type { MonitorPerformanceBucket } from "../repositories/monitor-performance.repository.ts";

/** Labels the list's 112-pixel strip names before the tail is grouped. */
const MAX_LABELS_SHOWN = 5;

const OTHER_LABEL = "Other";

type LabelDistribution = {
  labels: LabelShare[];
  current: number | null;
  previous: number | null;
};

const countLabels = (buckets: MonitorPerformanceBucket[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const bucket of buckets) {
    for (const [label, count] of Object.entries(bucket.labelCounts)) {
      counts.set(label, (counts.get(label) ?? 0) + count);
    }
  }
  return counts;
};

const totalOf = (counts: Map<string, number>): number =>
  [...counts.values()].reduce((total, count) => total + count, 0);

/** Most common first; the tail past the strip is grouped so shares still add up to one. */
const toLabelShares = (counts: Map<string, number>): LabelShare[] => {
  const total = totalOf(counts);
  if (total === 0) return [];

  const ordered = [...counts.entries()].toSorted(
    ([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || leftLabel.localeCompare(rightLabel),
  );
  const shares: LabelShare[] = ordered
    .slice(0, MAX_LABELS_SHOWN)
    .map(([label, count]) => ({ label, count, share: count / total, grouped: false }));

  const remainder = ordered.slice(MAX_LABELS_SHOWN);
  if (remainder.length > 0) {
    const count = remainder.reduce((sum, [, value]) => sum + value, 0);
    shares.push({ label: OTHER_LABEL, count, share: count / total, grouped: true });
  }
  return shares;
};

/**
 * Whether a monitor reads as labels: never a guardrail, never an evaluator
 * that scored anything in either period, only one that produced labels.
 */
export function readsAsLabels({
  buckets,
  isGuardrail,
}: {
  buckets: MonitorPerformanceBucket[];
  isGuardrail: boolean;
}): boolean {
  if (isGuardrail) return false;
  if (buckets.some((bucket) => bucket.scoreCount > 0)) return false;
  return buckets.some((bucket) => Object.keys(bucket.labelCounts).length > 0);
}

/**
 * The current period's labels, and the leading label's share now and before.
 * An absent label in a previous period with results is a real zero; a
 * previous period with no results at all supports no comparison.
 */
export function labelDistribution({
  buckets,
}: {
  buckets: MonitorPerformanceBucket[];
}): LabelDistribution {
  const labels = toLabelShares(
    countLabels(buckets.filter((bucket) => bucket.period === "current")),
  );
  const leading = labels[0];
  const previousCounts = countLabels(buckets.filter((bucket) => bucket.period === "previous"));
  const previousTotal = totalOf(previousCounts);

  return {
    labels,
    current: leading?.share ?? null,
    previous:
      leading && !leading.grouped && previousTotal > 0
        ? (previousCounts.get(leading.label) ?? 0) / previousTotal
        : null,
  };
}
