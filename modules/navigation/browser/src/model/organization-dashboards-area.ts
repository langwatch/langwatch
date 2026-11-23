/**
 * Whether the organization's Dashboards library opens (ADR-002, decision 6). The page names no
 * project, so both of its flags are asked of the organization. With the new flag off the address
 * is "legacy", read as before; with Dashboards off it is "closed", a not-found.
 */

/** One flag's read for a set of organizations, as `isEnabledForEachOrganization` answers it. */
export type OrganizationFlagRead = {
  data?: { enabledByOrganizationId?: Record<string, boolean> };
  isLoading: boolean;
  isError?: boolean;
};

export type OrganizationDashboardsArea = "loading" | "open" | "closed" | "legacy";

/** A failed read answers off rather than "not yet", or a refused reader waits forever. */
export function organizationDashboardsArea({
  organizationId,
  organizationArea,
  dashboards,
}: {
  organizationId: string | undefined;
  organizationArea: OrganizationFlagRead;
  dashboards: OrganizationFlagRead;
}): OrganizationDashboardsArea {
  if (organizationId === void 0) return "loading";
  const reads = [organizationArea, dashboards];
  const isPending = (read: OrganizationFlagRead) =>
    read.isError !== true && (read.isLoading || read.data === void 0);
  if (reads.some(isPending)) return "loading";
  const isOn = (read: OrganizationFlagRead) =>
    read.data?.enabledByOrganizationId?.[organizationId] === true;
  if (!isOn(organizationArea)) return "legacy";
  return isOn(dashboards) ? "open" : "closed";
}
