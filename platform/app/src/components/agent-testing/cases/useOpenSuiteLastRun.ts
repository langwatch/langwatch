/**
 * Opens the last run of one test suite from the rail.
 *
 * A suite is a grouping and not a run plan, so its last run is the newest run
 * that covered one of its scenarios, whatever plan started it. The run opens
 * on the Results tab under the plan that holds it, which is the one place a
 * whole run reads.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { useCallback, useMemo } from "react";
import { type PlanIdentity, planOfSet } from "./plan-of-set";
import type { TestSuiteEntry } from "./test-cases";
import { useOpenPlanRun } from "./useOpenPlanRun";
import type { SuiteLastRun } from "./useTestCasesData";

export function useOpenSuiteLastRun({
  suites,
  lastRunBySuiteId,
}: {
  suites: TestSuiteEntry[];
  lastRunBySuiteId: ReadonlyMap<string, SuiteLastRun>;
}): (suite: TestSuiteEntry) => void {
  const openPlanRun = useOpenPlanRun();

  const planBySuiteId = useMemo(
    () =>
      new Map<string, PlanIdentity>(
        suites.map((suite) => [
          suite.id,
          { planName: suite.name, planSlug: suite.slug },
        ]),
      ),
    [suites],
  );

  return useCallback(
    (suite: TestSuiteEntry) => {
      const lastRun = lastRunBySuiteId.get(suite.id);
      if (!lastRun) return;
      const plan = planOfSet({
        scenarioSetId: lastRun.scenarioSetId,
        planBySuiteId,
      });
      openPlanRun({
        // A run written into a set the Results tab lists no plan for still
        // belongs to this suite, so it opens under the plan of the suite.
        planSlug: plan?.planSlug ?? suite.slug,
        batchRunId: lastRun.batchRunId,
      });
    },
    [lastRunBySuiteId, planBySuiteId, openPlanRun],
  );
}
