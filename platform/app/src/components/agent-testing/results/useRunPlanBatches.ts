/**
 * The runs of one run plan inside the window, and the one the page is on.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import {
  type BatchRun,
  computeBatchRunSummary,
  computeIterationMap,
  groupRunsByBatchId,
} from "~/components/suites/run-history-transforms";
import { useRunHistoryPagination } from "~/components/suites/useRunHistoryPagination";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { batchNote, type RunPlan } from "./run-plans";
import { runTitle } from "./run-titles";

export type RunPlanBatches = ReturnType<typeof useRunPlanBatches>;
export type RunPlanSelection = ReturnType<typeof useSelectedBatch>;

export function useRunPlanBatches({
  plan,
  period,
  isSseConnected,
}: {
  plan: RunPlan;
  period: Period;
  /** While the live stream is up the fallback polling stands down. */
  isSseConnected: boolean;
}) {
  const { project } = useOrganizationTeamProject();
  const startDateMs = period.startDate.getTime();

  const pagination = useRunHistoryPagination({
    scenarioSetId: plan.scenarioSetId,
    startDateMs,
    sseConnected: isSseConnected,
  });

  // The run number counts the runs of the window, so the newest run of the
  // window carries the count itself. No upper bound, for the same reason
  // useRunHistoryPagination sends none: the pinned `period.endDate` would
  // hold the count at page load while the list keeps growing, and the run
  // numbers would stop matching the rows.
  const { data: batchCount } =
    api.scenarios.getScenarioSetBatchRunCount.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioSetId: plan.scenarioSetId,
        startDate: startDateMs,
      },
      { enabled: !!project },
    );

  const batchRuns = useMemo(
    () => groupRunsByBatchId({ runs: pagination.allRuns }),
    [pagination.allRuns],
  );

  return {
    ...pagination,
    batchRuns,
    totalBatchCount: batchCount?.count ?? null,
  };
}

/** The run the address holds, or the newest one when it holds none. */
function findSelectedBatch({
  batchRuns,
  batchRunId,
}: {
  batchRuns: BatchRun[];
  batchRunId: string | null;
}): BatchRun | null {
  if (!batchRunId) return batchRuns[0] ?? null;
  return batchRuns.find((batch) => batch.batchRunId === batchRunId) ?? null;
}

export function useSelectedBatch({
  batches,
  batchRunId,
}: {
  batches: RunPlanBatches;
  batchRunId: string | null;
}) {
  const { batchRuns, totalBatchCount } = batches;

  // The address may hold no run yet. The newest run of the plan is what the
  // page opens on, without pushing an address nobody asked for.
  const selectedBatch = useMemo(
    () => findSelectedBatch({ batchRuns, batchRunId }),
    [batchRuns, batchRunId],
  );

  const summary = useMemo(
    () =>
      selectedBatch
        ? computeBatchRunSummary({ batchRun: selectedBatch })
        : null,
    [selectedBatch],
  );

  const iterationMap = useMemo(
    () =>
      computeIterationMap({ scenarioRuns: selectedBatch?.scenarioRuns ?? [] }),
    [selectedBatch],
  );

  const selectedIndex = selectedBatch ? batchRuns.indexOf(selectedBatch) : -1;

  return {
    selectedBatch,
    // The address names a run the window does not hold: one that has not
    // reported its first scenario yet, or one older than the window.
    awaitedBatchRunId: batchRunId && !selectedBatch ? batchRunId : null,
    summary,
    iterationMap,
    title: selectedBatch
      ? runTitle({
          index: Math.max(selectedIndex, 0),
          totalCount: totalBatchCount,
          loadedCount: batchRuns.length,
        })
      : null,
    note: selectedBatch ? batchNote(selectedBatch.scenarioRuns) : null,
    isBatchRunning:
      !!summary && summary.inProgressCount + summary.queuedCount > 0,
  };
}
