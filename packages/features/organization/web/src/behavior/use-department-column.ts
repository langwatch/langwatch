import { api, type RouterOutputs } from "../behavior/organization-api";

export type DepartmentOption = RouterOutputs["departments"]["list"][number];

/**
 * Shared data + gating for the department assignment control that members /
 * teams / projects pages render inline. The control only appears once the
 * org actually has departments configured (and the governance flag is on),
 * mirroring how the role/access columns only show what's relevant. Fetches
 * the list + current assignments once; consumers read the per-entity current
 * value out of the returned lookup maps.
 */
export function useDepartmentColumn(
  organizationId: string,
  /**
   * Whether AI governance is switched on for this organization.
   *
   * TAKEN, NOT READ, and that is load-bearing. This hook used to ask a
   * `useFeatureFlag` shim, which asked the ORGANIZATION host — and the general
   * settings page in `@langwatch/project-web` renders the same control under
   * the PROJECT host, where that read throws. A shim over a host port is only
   * safe for a module one composition ever mounts, and this one has two. The
   * caller already holds its own host, so it answers the flag.
   */
  governanceEnabled: boolean,
) {
  const ffOn = governanceEnabled;

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

  const byUser = new Map(assignments?.users.map((u) => [u.id, u.departmentId]) ?? []);
  const byTeam = new Map(assignments?.teams.map((t) => [t.id, t.departmentId]) ?? []);
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
