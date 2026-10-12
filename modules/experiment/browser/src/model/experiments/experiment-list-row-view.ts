import type { ExperimentRun } from "@langwatch/experiment-contract";

import {
  cellProgressOf,
  defaultMetric,
  describeChange,
  headlineOf,
  leadMetric,
  metricsOfRuns,
  runCost,
  runsAreFresh,
  runsOldestFirst,
  sparklineOf,
  summariseResult,
  type CellProgress,
  type ChangeInWords,
  type ListMetric,
  type ResultHeadline,
} from "./experiment-list-metrics.ts";
import {
  opensInWorkbench,
  runStatusOf,
  targetCountOfRow,
  type ExperimentListRow,
  type RunStatus,
} from "./experiment-list-row.ts";

/** What a result cell says when it has no headline. */
export type ResultState = "loading" | "no-runs" | "no-evaluators" | "no-numeric" | "no-result";

/** Everything a closed row shows, worked out from the list row and the runs that came for it. */
export type RowView = {
  /** Oldest first. */
  runs: ExperimentRun[];
  /** Whether the runs are the ones the list describes. */
  fresh: boolean;
  metrics: ListMetric[];
  /** The metric the row leads with: the person's pick, else the default. */
  metric: ListMetric | undefined;
  /** What the row leads with without a pick. */
  fallback: ListMetric | undefined;
  chosen: boolean;
  headline: ResultHeadline | undefined;
  change: ChangeInWords | undefined;
  sparkline: number[];
  /** Targets of a workbench experiment, when there is more than one. */
  targets: number | undefined;
  targetCount: number | undefined;
  items: number | undefined;
  cost: number | undefined;
  status: RunStatus;
  progress: CellProgress | undefined;
  state: ResultState;
};

function changeOf({ runs, metric }: { runs: ExperimentRun[]; metric: ListMetric | undefined }) {
  const change = metric ? summariseResult({ runs, metric })?.change : undefined;
  if (!metric || !change) return undefined;
  return describeChange({
    delta: change.delta,
    kind: metric.kind,
    against: change.againstRunNumber,
  });
}

function stateOf({
  hasRuns,
  loading,
  fresh,
  metrics,
  reported,
}: {
  hasRuns: boolean;
  loading: boolean;
  fresh: boolean;
  /** Evaluators with a number. */
  metrics: number;
  /** Evaluators that reported anything, numbers or not. */
  reported: boolean;
}): ResultState {
  if (!hasRuns) return "no-runs";
  if (loading && !fresh) return "loading";
  if (!fresh || metrics > 0) return "no-result";
  return reported ? "no-numeric" : "no-evaluators";
}

/**
 * A closed row's view. Cached runs count only while they match the list, so one headline serves a
 * closed and an open row; until then the list's own summary draws the row.
 */
export function rowViewOf({
  experiment,
  runs: fetched,
  chosenKey,
  loading,
  nowMs,
}: {
  experiment: ExperimentListRow;
  runs: ExperimentRun[];
  chosenKey: string | undefined;
  /** The row's runs are on their way: waiting for a slot or in flight. */
  loading: boolean;
  nowMs: number;
}): RowView {
  const runs = runsOldestFirst(fetched);
  const { runsSummary } = experiment;
  const listPrimary = runsSummary.primaryMetric;
  const fresh = runsAreFresh({ runs, runsSummary });
  const metrics = metricsOfRuns(runs);
  const metric = leadMetric({ metrics, chosenKey, listPrimary });
  const known = fresh ? runs : [];
  const shown = fresh ? metric : undefined;
  const latest = known.at(-1);
  const workbench = opensInWorkbench(experiment);
  const targetCount = targetCountOfRow(experiment);
  const status = runStatusOf({ runsSummary, nowMs });
  return {
    runs,
    fresh,
    metrics,
    metric,
    fallback: defaultMetric({ metrics, listPrimary }),
    chosen: !!metric && metric.key === chosenKey,
    headline: headlineOf({ runs: known, metric: shown, listPrimary }),
    change: status === "running" ? undefined : changeOf({ runs: known, metric: shown }),
    sparkline: shown ? sparklineOf({ runs: known, metric: shown }) : [],
    targets: targetCount && targetCount > 1 ? targetCount : undefined,
    targetCount,
    items:
      workbench && targetCount && latest?.total
        ? Math.round(latest.total / targetCount)
        : undefined,
    cost: latest ? runCost(latest) : undefined,
    status,
    progress:
      status === "running" || status === "stopped"
        ? cellProgressOf({ run: latest, workbench })
        : undefined,
    state: stateOf({
      hasRuns: runsSummary.count > 0,
      loading,
      fresh,
      metrics: metrics.length,
      reported: runs.some((run) => Object.keys(run.summary.evaluations).length > 0),
    }),
  };
}
