/**
 * The charts of a comparison run: the targets next to each other on the
 * numbers a person compares them by, and how each target has done over the
 * runs of the plan.
 *
 * Every number is read off the runs the page already holds, on the one
 * formula every group of runs is summed with, so a bar here and the pill on
 * the column header say the same thing.
 *
 * "Pass rate over runs" draws the runs of the plan the rail has loaded,
 * oldest first, one bar per target. A target is matched across runs by its
 * key, so the same agent on the same parameters lines up from run to run, and
 * a run that did not go against a target draws a gap for it.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Grid } from "@chakra-ui/react";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import type {
  BatchRun,
  RunGroupSummary,
} from "~/components/suites/run-history-transforms";
import { MiniBarCard, type MiniBarGroup } from "../shared/MiniBarCard";
import { formatPassRate } from "../shared/pass-rate-color";
import { runTitle } from "./run-titles";
import { type BatchTarget, summaryOfTarget } from "./useBatchTargets";

export type ComparisonChartsBlockProps = {
  targets: BatchTarget[];
  /** The run on screen. */
  batch: BatchRun;
  /** Every run of the plan the rail holds, newest first. */
  batchRuns: BatchRun[];
  totalBatchCount: number | null;
};

/**
 * One bar per target on one number of the run on screen.
 *
 * The label under a bar is the short one, so two targets of one agent read
 * as what tells them apart rather than as the same truncated name twice.
 * The full label reads on hover.
 */
function targetGroups({
  targets,
  summaries,
  read,
}: {
  targets: BatchTarget[];
  summaries: Map<string, RunGroupSummary>;
  read: (summary: RunGroupSummary) => { value: number | null; text: string };
}): MiniBarGroup[] {
  return targets.map((target) => {
    const summary = summaries.get(target.key);
    const { value, text } = summary
      ? read(summary)
      : { value: null, text: "-" };
    return {
      key: target.key,
      label: target.shortLabel,
      title: target.label,
      bars: [{ key: target.key, color: target.color, value, text }],
    };
  });
}

const passRateOf = (summary: RunGroupSummary) => ({
  value: summary.passRate,
  text: formatPassRate(summary.passRate),
});

const totalCostOf = (summary: RunGroupSummary) => ({
  value: summary.totalCost,
  text: summary.totalCost === null ? "-" : formatCost(summary.totalCost),
});

const averageLatencyOf = (summary: RunGroupSummary) => ({
  value: summary.averageAgentLatencyMs,
  text:
    summary.averageAgentLatencyMs === null
      ? "-"
      : formatLatency(summary.averageAgentLatencyMs),
});

/** One group per run of the plan, oldest first, one bar per target. */
function passRateOverRuns({
  targets,
  batchRuns,
  totalBatchCount,
}: Pick<
  ComparisonChartsBlockProps,
  "targets" | "batchRuns" | "totalBatchCount"
>): MiniBarGroup[] {
  return batchRuns
    .map((batch, index) => ({
      key: batch.batchRunId,
      label: runTitle({
        index,
        totalCount: totalBatchCount,
        loadedCount: batchRuns.length,
      }),
      bars: targets.map((target) => {
        const summary = summaryOfTarget({
          scenarioRuns: batch.scenarioRuns,
          target,
        });
        const { value, text } =
          summary.totalCount > 0
            ? passRateOf(summary)
            : { value: null, text: "-" };
        return { key: target.key, color: target.color, value, text };
      }),
    }))
    .reverse();
}

export function ComparisonChartsBlock({
  targets,
  batch,
  batchRuns,
  totalBatchCount,
}: ComparisonChartsBlockProps) {
  const summaries = new Map(
    targets.map((target) => [
      target.key,
      summaryOfTarget({ scenarioRuns: batch.scenarioRuns, target }),
    ]),
  );

  return (
    <Grid
      gap={3}
      alignItems="stretch"
      gridTemplateColumns={{
        base: "repeat(2, minmax(0, 1fr))",
        lg: "repeat(3, minmax(0, 1fr)) minmax(0, 1.4fr)",
      }}
      data-testid="comparison-charts"
    >
      <MiniBarCard
        title="Pass rate"
        scale={100}
        groups={targetGroups({ targets, summaries, read: passRateOf })}
        testId="comparison-chart-pass-rate"
      />
      <MiniBarCard
        title="Total cost"
        groups={targetGroups({ targets, summaries, read: totalCostOf })}
        testId="comparison-chart-cost"
      />
      <MiniBarCard
        title="Average reply latency"
        groups={targetGroups({ targets, summaries, read: averageLatencyOf })}
        testId="comparison-chart-latency"
      />
      <MiniBarCard
        title="Pass rate over runs"
        scale={100}
        groups={passRateOverRuns({ targets, batchRuns, totalBatchCount })}
        testId="comparison-chart-pass-rate-over-runs"
      />
    </Grid>
  );
}
