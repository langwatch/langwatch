import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
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
    // Members and departments are organization settings. No project takes
    // part in the read.
    projectId: NOT_TARGETED,
    organizationId,
    enabled: !!organizationId,
  });

  // The control also renders on pages every member can open, and the lists
  // behind it need `governance:view`. Without the grant there is nothing to
  // read, so nothing is asked.
  const { hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const enabled = !!organizationId && ffOn && hasPermission("governance:view");

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
    refetch: () => utils.departments.assignments.invalidate({ organizationId }),
  };
}
