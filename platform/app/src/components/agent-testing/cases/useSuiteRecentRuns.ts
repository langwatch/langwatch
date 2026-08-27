/**
 * The recent runs that covered a scenario of one test suite, read for the list
 * under the cases table.
 *
 * A run belongs to the run plan it was started under, and a run of one
 * scenario is a plan of its own, so a list keyed on a plan named after the
 * suite would miss most of what the suite has run. The list is keyed on the
 * scenarios instead: every batch of the period that ran one of them, whatever
 * plan it belongs to, and each row carries the plan so the reader can tell two
 * of them apart and the row can open the run under the plan that holds it.
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
import { isInternalSetId } from "~/server/scenarios/internal-set-id";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { toExternalPlanSlug } from "../results/run-plans";

/** How many runs the list holds. It is a way into a run, not a run history. */
export const RECENT_RUNS_SHOWN = 8;

/**
 * How many batches of the project the read takes before they are narrowed to
 * the suite. The whole period is read as one page, so a suite whose runs are
 * spread between many plans still finds its own.
 */
export const RECENT_RUNS_READ = 100;

/** One run covering a scenario of the suite, in the little a row reads. */
export type RecentRun = {
  batchRunId: string;
  /** The run plan the run was started under, as the Results tab names it. */
  planName: string;
  /** The address segment that plan is opened by. */
  planSlug: string;
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

/** The plan of one run set: the suite that owns it, or the code that wrote it. */
type PlanIdentity = { planName: string; planSlug: string };

function planOfSet({
  scenarioSetId,
  planBySuiteId,
}: {
  scenarioSetId: string | undefined;
  planBySuiteId: Map<string, PlanIdentity>;
}): PlanIdentity | null {
  if (!scenarioSetId) return null;
  const suiteId = extractSuiteId(scenarioSetId);
  if (suiteId) return planBySuiteId.get(suiteId) ?? null;
  // The reserved sets of the platform are not run plans and the Results tab
  // lists none of them, so a run of one has nothing to open.
  if (isInternalSetId(scenarioSetId)) return null;
  // Any other set was written by a code run, and the Results tab lists it
  // under the name the code gave it.
  return {
    planName: scenarioSetId,
    planSlug: toExternalPlanSlug(scenarioSetId),
  };
}

export function useSuiteRecentRuns({
  scenarioIds,
  period,
  enabled,
}: {
  /** The scenarios filed under the open suite. */
  scenarioIds: string[];
  period: Period;
  enabled: boolean;
}): SuiteRecentRuns {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();
  const isEnabled = enabled && !!project && scenarioIds.length > 0;

  const { data, isLoading } = api.scenarios.getSuiteRunData.useQuery(
    { projectId, limit: RECENT_RUNS_READ, startDate, endDate },
    { enabled: isEnabled, trpc: { context: { skipBatch: true } } },
  );

  // The plans the runs belong to, for the name a row reads and the address it
  // opens. Read beside the runs, and just as lazily.
  const { data: suites } = api.suites.getAll.useQuery(
    { projectId, kinds: ["custom", "folder"] },
    { enabled: isEnabled },
  );

  const runs = useMemo<RecentRun[]>(() => {
    // The read answers "nothing moved" with no runs at all when it is asked
    // to skip a batch it has already served.
    const rows = data && "runs" in data ? data.runs : [];
    const scenarioSetIds = data && "runs" in data ? data.scenarioSetIds : {};
    const planBySuiteId = new Map<string, PlanIdentity>(
      (suites ?? []).map((suite) => [
        suite.id,
        { planName: suite.name, planSlug: suite.slug },
      ]),
    );
    const wanted = new Set(scenarioIds);

    return groupRunsByBatchId({ runs: rows, scenarioSetIds })
      .filter((batch) =>
        batch.scenarioRuns.some((run) => wanted.has(run.scenarioId)),
      )
      .flatMap((batch) => {
        const plan = planOfSet({
          scenarioSetId: batch.scenarioSetId,
          planBySuiteId,
        });
        // A run whose plan has not arrived yet, or was deleted, has nothing to
        // open and no name to read, so it waits rather than reading as blank.
        if (!plan) return [];
        const summary = computeBatchRunSummary({ batchRun: batch });
        return [
          {
            batchRunId: batch.batchRunId,
            planName: plan.planName,
            planSlug: plan.planSlug,
            timestamp: batch.timestamp,
            passRate: summary.passRate,
            isRunning: summary.inProgressCount + summary.queuedCount > 0,
          },
        ];
      })
      .slice(0, RECENT_RUNS_SHOWN);
  }, [data, suites, scenarioIds]);

  return { runs, isLoading: isEnabled && isLoading };
}
