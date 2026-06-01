import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { api, type RouterOutputs } from "~/utils/api";

export type CostCenterOption = RouterOutputs["costCenters"]["list"][number];

/**
 * Shared data + gating for the cost-center assignment control that members /
 * teams / projects pages render inline. The control only appears once the
 * org actually has cost centers configured (and the governance flag is on),
 * mirroring how the role/access columns only show what's relevant. Fetches
 * the list + current assignments once; consumers read the per-entity current
 * value out of the returned lookup maps.
 */
export function useCostCenterColumn(organizationId: string) {
  const { enabled: ffOn } = useFeatureFlag("release_ui_ai_governance_enabled", {
    organizationId,
    enabled: !!organizationId,
  });

  const enabled = !!organizationId && ffOn;

  const listQuery = api.costCenters.list.useQuery(
    { organizationId },
    { enabled, refetchOnWindowFocus: false },
  );
  const assignmentsQuery = api.costCenters.assignments.useQuery(
    { organizationId },
    { enabled, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();

  const costCenters = listQuery.data ?? [];
  const assignments = assignmentsQuery.data;

  const byUser = new Map(
    assignments?.users.map((u) => [u.id, u.costCenterId]) ?? [],
  );
  const byTeam = new Map(
    assignments?.teams.map((t) => [t.id, t.costCenterId]) ?? [],
  );
  const byProject = new Map(
    assignments?.projects.map((p) => [p.id, p.costCenterId]) ?? [],
  );

  return {
    show: ffOn && costCenters.length > 0,
    costCenters,
    byUser,
    byTeam,
    byProject,
    refetch: () =>
      utils.costCenters.assignments.invalidate({ organizationId }),
  };
}
