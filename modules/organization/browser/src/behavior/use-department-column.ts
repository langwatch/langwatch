import { api, type RouterOutputs } from "./organization-api.ts";

export type DepartmentOption = RouterOutputs["departments"]["list"][number];

/**
 * Shared data + gating for the department assignment control the members /
 * teams / projects pages render inline, appearing only once the org has
 * departments configured and the governance flag is on.
 */
export function useDepartmentColumn(
  organizationId: string,
  /**
   * Whether AI governance is switched on for this organization.
   * Taken as param to avoid host-specific reads in a multi-composition module.
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
  const byProject = new Map(assignments?.projects.map((p) => [p.id, p.departmentId]) ?? []);

  return {
    show: ffOn && departments.length > 0,
    departments,
    byUser,
    byTeam,
    byProject,
    refetch: () => utils.departments.assignments.invalidate({ organizationId }),
  };
}
