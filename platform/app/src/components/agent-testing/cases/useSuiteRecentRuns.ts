/**
 * The recent runs of one test suite, read for the list under the cases table.
 *
 * The read is asked for only when the list is opened. The Scenarios tab is an
 * authoring surface, so a suite that nobody opens the list on downloads no
 * runs at all.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import {
  computeBatchRunSummary,
  groupRunsByBatchId,
} from "~/components/suites/run-history-transforms";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { runOrdinal } from "../results/run-plans";

/** How many runs the list holds. It is a way into a run, not a run history. */
export const RECENT_RUNS_SHOWN = 8;

/** One run of the suite, in the little a compact row reads. */
export type RecentRun = {
  batchRunId: string;
  /** The number the run carries in the window, as the runs rail numbers it. */
  ordinal: number;
  timestamp: number;
  /** 0 to 100, or null while nothing has settled. */
  passRate: number | null;
  /** True while the run still has scenarios to judge. */
  isRunning: boolean;
};

export type SuiteRecentRuns = {
  runs: RecentRun[];
  isLoading: boolean;
};

export function useSuiteRecentRuns({
  scenarioSetId,
  period,
  enabled,
}: {
  scenarioSetId: string;
  period: Period;
  enabled: boolean;
}): SuiteRecentRuns {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const isEnabled = enabled && !!project && !!scenarioSetId;

  const { data, isLoading } = api.scenarios.getSuiteRunData.useQuery(
    { projectId, scenarioSetId, limit: 20, startDate },
    { enabled: isEnabled, trpc: { context: { skipBatch: true } } },
  );

  // The number of a run counts the runs of the window, so it needs the count
  // the window holds and not only the page that was read.
  const { data: batchCount } =
    api.scenarios.getScenarioSetBatchRunCount.useQuery(
      { projectId, scenarioSetId, startDate },
      { enabled: isEnabled },
    );

  const runs = useMemo<RecentRun[]>(() => {
    // The read serves one set and the whole project alike, and the answer for
    // the whole project can be "nothing moved" and carry no runs at all.
    const rows = data && "runs" in data ? data.runs : [];
    const batches = groupRunsByBatchId({ runs: rows });
    return batches.slice(0, RECENT_RUNS_SHOWN).map((batch, index) => {
      const summary = computeBatchRunSummary({ batchRun: batch });
      return {
        batchRunId: batch.batchRunId,
        ordinal: runOrdinal({
          index,
          totalCount: batchCount?.count ?? null,
          loadedCount: batches.length,
        }),
        timestamp: batch.timestamp,
        passRate: summary.passRate,
        isRunning: summary.inProgressCount + summary.queuedCount > 0,
      };
    });
  }, [data, batchCount]);

  return { runs, isLoading: isEnabled && isLoading };
}
