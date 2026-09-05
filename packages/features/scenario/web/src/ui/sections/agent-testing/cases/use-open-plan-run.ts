/**
 * Opens one run of a run plan from the Scenarios tab.
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/page-structure.feature
 */

import { useCallback } from "react";
import { useRouter } from "@langwatch/ui-host/use-router";
import { buildAgentTestingPush } from "../../../../behavior/agent-testing/use-agent-testing-routing";

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
