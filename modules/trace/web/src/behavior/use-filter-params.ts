/**
 * The trace-list filter, as the evaluator's mapping preview asks for it.
 */

import { useMemo } from "react";

import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { nowInstant } from "@langwatch/time";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function useFilterParams() {
  const { project } = useOrganizationTeamProject();
  return useMemo(() => {
    const endDate = nowInstant().epochMilliseconds;
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
