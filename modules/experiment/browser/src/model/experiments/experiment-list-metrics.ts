import type { ExperimentRun } from "@langwatch/experiment-contract";

/**
 * An evaluator a row can lead with. A pass/fail evaluator reads as a pass rate, higher is better
 * by definition. A score evaluator reads as its average: LangWatch stores no direction for a
 * score, so nothing is ranked or called better on one.
 */
export type ListMetric = {
  /** Unique per picker row: an evaluator offering a pass rate and a score appears twice. */
  key: string;
  evaluatorId: string;
  label: string;
  kind: "passRate" | "score";
};

export const DEFAULT_METRIC_RULE =
  "the first evaluator the latest run reports; without that, the first pass/fail evaluator by name, else the first score evaluator by name that is not a plain measurement (latency, duration, response time, tokens or cost)";

export const DEFAULT_METRIC_WHY =
  "The list and the open row lead with the same evaluator, so the number does not change when a row is opened.";

/**
 * Evaluator names that report a measurement, matched whole once units are dropped:
 * "token_overlap" is a real score.
 */
const MEASUREMENT_NAMES = new Set([
  "latency",
  "duration",
  "time",
  "response_time",
  "cost",
  "tokens",
  "token_count",
  "total_cost",
  "total_tokens",
  "prompt_tokens",
  "input_tokens",
  "completion_tokens",
  "output_tokens",
]);

const UNIT_SUFFIX = /_(ms|s|sec|secs|seconds|milliseconds|usd)$/;

/** "Latency (ms)" -> "latency", "Response Time" -> "response_time". */
const normaliseName = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(UNIT_SUFFIX, "");

const isMeasurementName = (label: string) => MEASUREMENT_NAMES.has(normaliseName(label));

const scoreKeyOf = (evaluatorId: string) => `${evaluatorId}:score`;

/** Oldest first, the order the experiment page numbers runs in. */
export const runsOldestFirst = (runs: ExperimentRun[]): ExperimentRun[] =>
  runs.toSorted(
    (a, b) => a.timestamps.createdAt - b.timestamps.createdAt || a.runId.localeCompare(b.runId),
  );

/** Every evaluator the runs report: pass/fail ones by name, then score ones by name. */
export function metricsOfRuns(runs: ExperimentRun[]): ListMetric[] {
  const passFail = new Map<string, string>();
  const scored = new Map<string, string>();
  for (const run of runs) {
    for (const [id, evaluation] of Object.entries(run.summary.evaluations)) {
      if (evaluation.averagePassed !== undefined) passFail.set(id, evaluation.name);
      if (evaluation.averageScore !== null) scored.set(id, evaluation.name);
    }
  }
  const byName = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  return [
    ...[...passFail]
      .toSorted(byName)
      .map(([id, label]): ListMetric => ({ key: id, evaluatorId: id, label, kind: "passRate" })),
    ...[...scored].toSorted(byName).map(([id, label]): ListMetric => ({
      key: passFail.has(id) ? scoreKeyOf(id) : id,
      evaluatorId: id,
      label,
      kind: "score",
    })),
  ];
}

export function defaultMetric(
  metrics: ListMetric[],
  listPrimary?: ListPrimaryMetric | null,
): ListMetric | undefined {
  const fromList = listPrimary && metricOfListPrimary(metrics, listPrimary);
  return (
    fromList ??
    metrics.find((metric) => metric.kind === "passRate") ??
    metrics.find((metric) => !isMeasurementName(metric.label)) ??
    metrics[0]
  );
}

/** The metric the list query's own summary names, found among the runs' evaluators by name. */
function metricOfListPrimary(
  metrics: ListMetric[],
  primary: ListPrimaryMetric,
): ListMetric | undefined {
  const kind = primary.averagePassed !== undefined ? "passRate" : "score";
  return metrics.find((metric) => metric.label === primary.name && metric.kind === kind);
}

/** The person's pick when it still exists, else the default. */
export function leadMetric(
  metrics: ListMetric[],
  chosenKey: string | undefined,
  listPrimary?: ListPrimaryMetric | null,
): ListMetric | undefined {
  return metrics.find((metric) => metric.key === chosenKey) ?? defaultMetric(metrics, listPrimary);
}

/** What an opened row says when no evaluator has a number: nothing ran, or only categories. */
export function noMetricNote(runs: ExperimentRun[]): string {
  const reported = runs.some((run) => Object.keys(run.summary.evaluations).length > 0);
  return reported
    ? "No numeric results: this experiment's evaluators report categories only."
    : "No scored runs yet.";
}

/** Whether the cached runs are the ones the list describes: same count, same newest run. */
export function runsAreFresh({
  runs,
  runsSummary,
}: {
  /** Oldest first. */
  runs: ExperimentRun[];
  runsSummary: {
    count: number;
    latestRun?: { timestamps?: { createdAt?: number | null } | null } | null;
  };
}): boolean {
  if (runs.length === 0 || runs.length !== runsSummary.count) return false;
  const listed = runsSummary.latestRun?.timestamps?.createdAt;
  return listed == null || runs.at(-1)!.timestamps.createdAt === listed;
}

/** Pass rate in percent (one decimal), or the average score; undefined without a value. */
export function pooledValue(run: ExperimentRun, metric: ListMetric): number | undefined {
  const evaluation = run.summary.evaluations[metric.evaluatorId];
  if (!evaluation) return undefined;
  if (metric.kind === "passRate") {
    return evaluation.averagePassed === undefined
      ? undefined
      : Math.round(evaluation.averagePassed * 1000) / 10;
  }
  return evaluation.averageScore ?? undefined;
}

/** Dataset plus evaluation cost of one run; undefined when it reports neither. */
export function runCost(run: ExperimentRun): number | undefined {
  const { datasetCost, evaluationsCost } = run.summary;
  return datasetCost === undefined && evaluationsCost === undefined
    ? undefined
    : (datasetCost ?? 0) + (evaluationsCost ?? 0);
}

export const metricNoun = (metric: ListMetric) =>
  metric.kind === "passRate" ? "pass rate" : "average score";

/** An average score at a readable precision, whatever the evaluator's scale. */
export function formatScore(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return Math.round(value).toLocaleString("en-US");
  if (magnitude >= 100) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

export const formatMetricValue = (metric: ListMetric, value: number) =>
  metric.kind === "passRate" ? `${value.toFixed(1)}%` : formatScore(value);

export type ChangeInWords = { text: string; tone: "good" | "bad" | "flat" };

/**
 * A change between two values of one metric against an earlier run, in words:
 * "1.3 pt better than run #2", "0.12 higher than run #2", "no change from run #2".
 */
export function describeChange({
  delta,
  kind,
  against,
}: {
  delta: number;
  kind: ListMetric["kind"];
  /** The number of the run it is compared with. */
  against: number;
}): ChangeInWords {
  const size = Math.abs(delta);
  const flatText = `no change from run #${against}`;
  if (kind === "score") {
    const flat = Number(formatScore(size).replace(/,/g, "")) === 0;
    return {
      text: flat
        ? flatText
        : `${formatScore(size)} ${delta > 0 ? "higher" : "lower"} than run #${against}`,
      tone: "flat",
    };
  }
  if (size < 0.5) return { text: flatText, tone: "flat" };
  const better = delta > 0;
  return {
    text: `${size.toFixed(1)} pt ${better ? "better" : "worse"} than run #${against}`,
    tone: better ? "good" : "bad",
  };
}

/** Why the row leads with this metric, for the picker's explanation. */
export function metricReason({
  metric,
  fallback,
  chosen,
}: {
  metric: ListMetric | undefined;
  fallback: ListMetric | undefined;
  chosen: boolean;
}): string {
  if (!metric) return "No evaluator has scored this experiment yet.";
  if (chosen)
    return `You picked ${metric.label} for this experiment. Without a pick it shows ${fallback?.label}.`;
  return `Shown by default: ${DEFAULT_METRIC_RULE}. ${DEFAULT_METRIC_WHY}`;
}

export type ResultSummary = {
  value: number;
  /** Run numbers count from 1, oldest first. */
  runNumber: number;
  /** Set when a newer run has no value for this metric. */
  newerRunNumber: number | undefined;
  /** The change against the scored run before this one. */
  change: { delta: number; againstRunNumber: number } | undefined;
};

/** The change of the run at `index` against the nearest earlier run that has a value. */
export function changeOfRun({
  runs,
  index,
  metric,
}: {
  runs: ExperimentRun[];
  index: number;
  metric: ListMetric;
}): ResultSummary["change"] {
  const value = pooledValue(runs[index]!, metric);
  const beforeIndex = runs.findLastIndex(
    (run, at) => at < index && pooledValue(run, metric) !== undefined,
  );
  if (value === undefined || beforeIndex < 0) return undefined;
  return {
    delta: value - pooledValue(runs[beforeIndex]!, metric)!,
    againstRunNumber: beforeIndex + 1,
  };
}

/** The row's headline: the metric's value in the newest run that has one, and how it moved. */
export function summarizeResult({
  runs,
  metric,
}: {
  runs: ExperimentRun[];
  metric: ListMetric;
}): ResultSummary | undefined {
  const scoredIndex = runs.findLastIndex((run) => pooledValue(run, metric) !== undefined);
  if (scoredIndex < 0) return undefined;
  return {
    value: pooledValue(runs[scoredIndex]!, metric)!,
    runNumber: scoredIndex + 1,
    newerRunNumber: scoredIndex < runs.length - 1 ? runs.length : undefined,
    change: changeOfRun({ runs, index: scoredIndex, metric }),
  };
}

/** What the list query alone says about an experiment's latest run: its first evaluator. */
export type ListPrimaryMetric = {
  name: string;
  averageScore: number | null;
  averagePassed?: number;
};

/** The closed row's headline, from the list query's own summary: no per-row request. */
export function headlineFromList(
  primary: ListPrimaryMetric | null | undefined,
): { metric: ListMetric; value: number } | undefined {
  if (!primary) return undefined;
  const base = { key: primary.name, evaluatorId: primary.name, label: primary.name };
  if (primary.averagePassed !== undefined) {
    return {
      metric: { ...base, kind: "passRate" },
      value: Math.round(primary.averagePassed * 1000) / 10,
    };
  }
  if (primary.averageScore === null) return undefined;
  return { metric: { ...base, kind: "score" }, value: primary.averageScore };
}

export type ResultHeadline = {
  metric: ListMetric;
  value: number;
  /** Why the shown run is not the newest one. */
  note?: string;
};

/**
 * The row's headline, open or closed: from fresh runs when they have a value for the metric, else
 * from the list query's own summary. The change against earlier runs lives in the opened panel.
 */
export function headlineOf({
  runs,
  metric,
  listPrimary,
}: {
  runs: ExperimentRun[];
  metric: ListMetric | undefined;
  listPrimary: ListPrimaryMetric | null | undefined;
}): ResultHeadline | undefined {
  const result = metric ? summarizeResult({ runs, metric }) : undefined;
  if (!metric || !result) return headlineFromList(listPrimary);
  const { runNumber, newerRunNumber } = result;
  return {
    metric,
    value: result.value,
    note:
      newerRunNumber === undefined
        ? undefined
        : `run #${runNumber}; #${newerRunNumber} has no ${metric.label} score`,
  };
}
