import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { api, type RouterOutputs } from "~/utils/api";

export type DepartmentOption = RouterOutputs["departments"]["list"][number];

/**
 * Shared data + gating for the department assignment control that members /
 * teams / projects pages render inline. The control only appears once the
 * org actually has departments configured (and the governance flag is on),
 * mirroring how the role/access columns only show what's relevant. Fetches
 * the list + current assignments once; consumers read the per-entity current
 * value out of the returned lookup maps.
 */
export function useDepartmentColumn(organizationId: string) {
  const { enabled: ffOn } = useFeatureFlag("release_ui_ai_governance_enabled", {
    organizationId,
    enabled: !!organizationId,
  });

  const enabled = !!organizationId && ffOn;

  const listQuery = api.departments.list.useQuery(
    { organizationId },
    { enabled, refetchOnWindowFocus: false },
  );
  const assignmentsQuery = api.departments.assignments.useQuery(
    { organizationId },
    { enabled, refetchOnWindowFocus: false },
  );
  const utils = api.useUtils();

  const departments = listQuery.data ?? [];
  const assignments = assignmentsQuery.data;

  const byUser = new Map(
    assignments?.users.map((u) => [u.id, u.departmentId]) ?? [],
  );
  const byTeam = new Map(
    assignments?.teams.map((t) => [t.id, t.departmentId]) ?? [],
  );
  const byProject = new Map(
    assignments?.projects.map((p) => [p.id, p.departmentId]) ?? [],
  );

  return {
    show: ffOn && departments.length > 0,
    departments,
    byUser,
    byTeam,
    byProject,
    refetch: () =>
      utils.departments.assignments.invalidate({ organizationId }),
  };
}
