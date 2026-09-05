/**
 * The trace-list filter, as the evaluator's mapping preview asks for it.
 */

import { useMemo } from "react";

import { useOrganizationTeamProject } from "./use-organization-team-project";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function useFilterParams() {
  const { project } = useOrganizationTeamProject();
  return useMemo(() => {
    const endDate = Date.now();
    return {
      filterParams: {
        projectId: project?.id ?? "",
        startDate: endDate - THIRTY_DAYS_MS,
        endDate,
        filters: {},
      },
      queryOpts: { enabled: !!project?.id, refetchOnWindowFocus: false },
    };
  }, [project?.id]);
}
