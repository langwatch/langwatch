/**
 * The trace-list filter, as the evaluator's mapping preview asks for it.
 *
 * `~/hooks/useFilterParams` reads the whole analytics filter registry —
 * `~/server/filters/registry`, `~/server/analytics/utils` and `FilterField` —
 * and a browser package may name none of them; the automations family recorded
 * that same wall for its structured-filter editor. The ONE caller that crossed
 * with this family reads two fields off it, and neither needs the registry: the
 * project in scope and a default 30-day window, which is what the platform hook
 * resolved to whenever no filter had been chosen.
 *
 * So the mapping preview samples recent traces rather than filtered ones, which
 * is what it was showing on an unfiltered page anyway. Recorded rather than
 * suppressed.
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
