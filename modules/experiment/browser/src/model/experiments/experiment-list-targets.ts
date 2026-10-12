import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";

import type { ListMetric } from "./experiment-list-metrics.ts";

type EvaluatorTally = { passed: number; failed: number; scores: number[] };

/** One target of a run, summarised from the items the run's results call returns. */
export type TargetResult = {
  id: string;
  /** The model without its provider prefix, else the target name. */
  label: string;
  /** The full model id, for the provider mark. */
  model: string | undefined;
  items: number;
  costUsd: number | undefined;
  p50Ms: number | undefined;
  errors: number;
  firstError: string | undefined;
  evaluators: Record<string, EvaluatorTally>;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const modelOf = (target: NonNullable<ExperimentRunWithItems["targets"]>[number]) => {
  const meta = target.metadata?.model;
  return target.model ?? (typeof meta === "string" ? meta : undefined) ?? undefined;
};

type RunTarget = NonNullable<ExperimentRunWithItems["targets"]>[number];

function tallyEvaluators(
  evaluations: ExperimentRunWithItems["evaluations"],
): Record<string, EvaluatorTally> {
  const evaluators: Record<string, EvaluatorTally> = {};
  for (const result of evaluations) {
    if (result.status === "error") continue;
    const tally = (evaluators[result.evaluator] ??= { passed: 0, failed: 0, scores: [] });
    if (result.passed === true) tally.passed += 1;
    if (result.passed === false) tally.failed += 1;
    if (result.score !== null && result.score !== undefined) tally.scores.push(result.score);
  }
  return evaluators;
}

function summariseTarget({
  target,
  label,
  rows,
  evaluations,
}: {
  target: RunTarget;
  label: string;
  rows: ExperimentRunWithItems["dataset"];
  evaluations: ExperimentRunWithItems["evaluations"];
}): TargetResult {
  const costs = [...rows, ...evaluations].flatMap((item) =>
    item.cost === null || item.cost === undefined ? [] : [item.cost],
  );
  const failed = rows.find((row) => !!row.error);
  return {
    id: target.id,
    label,
    model: modelOf(target),
    items: new Set(rows.map((row) => row.index)).size,
    costUsd: costs.length > 0 ? sum(costs) : undefined,
    p50Ms: median(rows.flatMap((row) => (row.duration == null ? [] : [row.duration]))),
    errors: rows.filter((row) => !!row.error).length,
    firstError: failed?.error ?? undefined,
    evaluators: tallyEvaluators(evaluations),
  };
}

/**
 * Per-target numbers of one run. Rows that name no target belong to the run's only target. When two
 * targets share a model the target name tells them apart.
 */
export function targetResultsOf(run: ExperimentRunWithItems): TargetResult[] {
  const targets = run.targets ?? [];
  const soleTarget = targets.length === 1 ? targets[0]!.id : undefined;
  const forTarget = (rowTargetId: string | null | undefined, id: string) =>
    (rowTargetId ?? soleTarget) === id;
  const models = targets.map((target) => modelOf(target)?.split("/").pop());
  return targets.map((target, index) => {
    const model = models[index];
    const shared = model !== undefined && models.filter((other) => other === model).length > 1;
    return summariseTarget({
      target,
      label: (shared ? `${model} · ${target.name}` : model) ?? target.name,
      rows: run.dataset.filter((row) => forTarget(row.targetId, target.id)),
      evaluations: run.evaluations.filter((result) => forTarget(result.targetId, target.id)),
    });
  });
}

/** A target's value for the metric: pass rate in percent, or the average score. */
export function targetValue(target: TargetResult, metric: ListMetric): number | undefined {
  const tally = target.evaluators[metric.evaluatorId];
  if (!tally) return undefined;
  if (metric.kind === "passRate") {
    const decided = tally.passed + tally.failed;
    return decided === 0 ? undefined : Math.round((tally.passed / decided) * 1000) / 10;
  }
  return tally.scores.length === 0 ? undefined : sum(tally.scores) / tally.scores.length;
}

/** Fewer decided items than this on either side and no winner is called. */
export const MIN_DECIDED_ITEMS_TO_CALL = 10;

/** Items a target passed or failed on this metric. */
export function decidedItems(target: TargetResult, metric: ListMetric): number {
  const tally = target.evaluators[metric.evaluatorId];
  return tally ? tally.passed + tally.failed : 0;
}

/** Either side has too few decided items for a gap to mean anything. */
export const hasTooFewItems = ({
  a,
  b,
  metric,
}: {
  a: TargetResult;
  b: TargetResult;
  metric: ListMetric;
}): boolean =>
  decidedItems(a, metric) < MIN_DECIDED_ITEMS_TO_CALL ||
  decidedItems(b, metric) < MIN_DECIDED_ITEMS_TO_CALL;

/**
 * Two pass rates are tied when either side has too few decided items, or the gap sits inside the
 * 95% interval of the difference (two independent proportions over the decided items). A 0.2 pt
 * lead on 1,000 items is noise; 5/5 against 0/5 is too little to call.
 */
export function isTied({
  a,
  b,
  metric,
}: {
  a: TargetResult;
  b: TargetResult;
  metric: ListMetric;
}): boolean {
  if (hasTooFewItems({ a, b, metric })) return true;
  const pa = (targetValue(a, metric) ?? 0) / 100;
  const pb = (targetValue(b, metric) ?? 0) / 100;
  const standardError = Math.sqrt(
    (pa * (1 - pa)) / Math.max(decidedItems(a, metric), 1) +
      (pb * (1 - pb)) / Math.max(decidedItems(b, metric), 1),
  );
  // Identical rates are tied, also at 0% and 100% where the standard error is zero. Differing
  // rates with a zero error over enough items (100% against 0%) are a real gap.
  return pa === pb || Math.abs(pa - pb) < 1.96 * standardError;
}

export type RankedTarget = { target: TargetResult; value: number; rank: number };

/**
 * Targets best first on a pass rate. Every target tied with the leader shares rank 1; the rest
 * rank by position, equal values sharing a rank. Score metrics are only ordered, never ranked
 * (no better direction is stored), so every target carries rank 0.
 */
export function rankTargets({
  targets,
  metric,
}: {
  targets: TargetResult[];
  metric: ListMetric;
}): RankedTarget[] {
  const scored = targets
    .flatMap((target) => {
      const value = targetValue(target, metric);
      return value === undefined ? [] : [{ target, value }];
    })
    .toSorted((a, b) => b.value - a.value);
  if (metric.kind === "score") return scored.map((entry) => ({ ...entry, rank: 0 }));
  const ranks: RankedTarget[] = [];
  for (const [index, entry] of scored.entries()) {
    ranks.push({
      ...entry,
      rank: rankOf({ entry, index, scored, previous: ranks[index - 1], metric }),
    });
  }
  return ranks;
}

function rankOf({
  entry,
  index,
  scored,
  previous,
  metric,
}: {
  entry: { target: TargetResult; value: number };
  index: number;
  scored: { target: TargetResult; value: number }[];
  previous: RankedTarget | undefined;
  metric: ListMetric;
}): number {
  const leader = scored[0];
  if (leader && entry === leader) return 1;
  // A thin target is never crowned beside a leader that has enough items to stand on.
  const thin = (target: TargetResult) => decidedItems(target, metric) < MIN_DECIDED_ITEMS_TO_CALL;
  const crownable = leader && (!thin(entry.target) || thin(leader.target));
  if (leader && crownable && isTied({ a: entry.target, b: leader.target, metric })) return 1;
  if (previous && previous.value === entry.value) return previous.rank;
  return index + 1;
}

/** "2.1 pt ahead" / "0.4 pt behind" for a gap between two targets of one run. */
export const describeGap = (delta: number): string =>
  Math.abs(delta).toFixed(1) === "0.0"
    ? "tied"
    : `${Math.abs(delta).toFixed(1)} pt ${delta > 0 ? "ahead" : "behind"}`;

/** The one line above the target table when the top is a tie, else undefined. */
export function tieNoteOf({
  ranked,
  tooFew,
}: {
  ranked: RankedTarget[];
  tooFew: boolean;
}): { lead: string; rest: string } | undefined {
  const leaders = ranked.filter((entry) => entry.rank === 1).length;
  if (ranked.length < 2 || leaders < 2) return undefined;
  if (tooFew) {
    return {
      lead: "Too few items to call a winner:",
      rest: `a target needs at least ${MIN_DECIDED_ITEMS_TO_CALL} scored items.`,
    };
  }
  const who = leaders === ranked.length ? `all ${leaders}` : `the top ${leaders}`;
  return {
    lead: "No clear winner:",
    rest: `${who} within noise (gaps inside the 95% interval).`,
  };
}

/** The gap chip between two targets: nothing inside the noise or with too few items. */
export function gapOf({
  a,
  b,
  metric,
  delta,
}: {
  a: TargetResult;
  b: TargetResult;
  metric: ListMetric;
  delta: number;
}): { text: string; ahead: boolean } | undefined {
  if (isTied({ a, b, metric })) return undefined;
  return { text: describeGap(delta), ahead: delta > 0 };
}
