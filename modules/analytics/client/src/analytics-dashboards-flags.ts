/**
 * The flags the organization's Dashboards area opens behind, each asked of the organization
 * (ADR-002, decision 6): its own flag, then `release_dashboards`. Navigation and analytics both
 * read them from here, so the shell and the pages never disagree.
 */
export const ORGANIZATION_DASHBOARDS_FLAGS = [
  "release_dashboards_organization_area",
  "release_dashboards",
] as const;

/** How long a read of them stays fresh: the browser's flag cadence, five minutes. */
export const ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS = 5 * 60_000;

/** One flag's read for a set of organizations, as `isEnabledForEachOrganization` answers it. */
export type OrganizationFlagRead = {
  data?: { enabledByOrganizationId?: Record<string, boolean> };
  isLoading: boolean;
  isError?: boolean;
};

/** "legacy" with the area's own flag off, "closed" with Dashboards off, "open" with both on. */
export type OrganizationDashboardsArea = "loading" | "open" | "closed" | "legacy";

/**
 * Whether the area opens: "loading" until the organization resolves and both reads answer, so a
 * slow organization never reads as shut. A read that failed with no answer held is off, or a
 * refused reader waits forever; a failed refetch keeps the answer it held.
 */
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
