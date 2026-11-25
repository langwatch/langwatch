/**
 * The flag the organization's Dashboards area opens behind, asked of the organization
 * (ADR-002, decision 6). Navigation and analytics both read it from here, so the shell and the
 * pages never disagree.
 */
export const ORGANIZATION_DASHBOARDS_FLAG = "release_dashboards";

/** How long a read of it stays fresh: the browser's flag cadence, five minutes. */
export const ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS = 5 * 60_000;

/** One flag's read for a set of organizations, as `isEnabledForEachOrganization` answers it. */
export type OrganizationFlagRead = {
  data?: { enabledByOrganizationId?: Record<string, boolean> };
  isLoading: boolean;
  isError?: boolean;
};

/** "closed" with Dashboards off for the organization, "open" with it on. */
export type OrganizationDashboardsArea = "loading" | "open" | "closed";

/**
 * Whether the area opens: "loading" until the organization resolves and the read answers, so a
 * slow organization never reads as shut. A read that failed with no answer held is off, or a
 * refused reader waits forever; a failed refetch keeps the answer it held.
 */
export function organizationDashboardsArea({
  organizationId,
  dashboards,
}: {
  organizationId: string | undefined;
  dashboards: OrganizationFlagRead;
}): OrganizationDashboardsArea {
  if (organizationId === void 0) return "loading";
  const isPending =
    dashboards.isError !== true && (dashboards.isLoading || dashboards.data === void 0);
  if (isPending) return "loading";
  return dashboards.data?.enabledByOrganizationId?.[organizationId] === true ? "open" : "closed";
}
