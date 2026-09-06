/**
 * Opens one run of a run plan from the Scenarios tab.
 *
 * The Scenarios tab holds no plan of its own, so it names both the plan and
 * the run in one push rather than pushing the plan and then the run. The push
 * is shallow, the way every move inside Agent Testing is, so the page keeps
 * its live-run subscription and a run that is still going keeps streaming.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useCallback } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { buildAgentTestingPush } from "../useAgentTestingRouting";

export type OpenPlanRunParams = {
  /** The address segment of the plan, which for a test suite is its slug. */
  planSlug: string;
  batchRunId: string;
};

export function useOpenPlanRun(): (params: OpenPlanRunParams) => void {
  const router = useRouter();
  const projectSlug = router.query.project as string | undefined;

  return useCallback(
    ({ planSlug, batchRunId }: OpenPlanRunParams) => {
      if (!projectSlug) return;

      const { route, address } = buildAgentTestingPush({
        projectSlug,
        state: {
          tab: "results",
          selection: { kind: "suite", slug: null },
          planSlug,
          batchRunId,
        },
        query: router.query,
      });

      void router.push(route, address, { shallow: true });
    },
    [router, projectSlug],
  );
}
